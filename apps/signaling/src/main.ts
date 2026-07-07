import express from "express";
import { createServer } from "http";
import { Server, Socket } from "socket.io";
import type {
  SignalingClientToServerEvents,
  SignalingServerToClientEvents,
} from "@glide/shared-types";

const DEFAULT_PORT = 4000;
const PORT = Number(process.env.PORT) || DEFAULT_PORT;
const JOIN_MAX_ATTEMPTS = 20;
const JOIN_BLOCK_DURATION_MS = 5 * 60 * 1000;

type SignalingSocket = Socket<
  SignalingClientToServerEvents,
  SignalingServerToClientEvents
>;
type SignalingServer = Server<
  SignalingClientToServerEvents,
  SignalingServerToClientEvents
>;

interface Room {
  sessionId: string;
  hostSocketId: string;
  phoneSocketId: string | null;
}

// sessionId -> room. Une room est créée par registerHost et détruite quand le
// PC se déconnecte ; le téléphone peut rejoindre/quitter/rejoindre librement
// entre les deux (verrouillage écran, coupure WiFi...).
const rooms = new Map<string, Room>();
// socket.id -> sessionId, pour retrouver la room d'un socket au disconnect
// sans scanner toutes les rooms.
const socketSessions = new Map<string, string>();

interface JoinAttemptRecord {
  count: number;
  blockedUntil: number;
}

// Bloque une IP après trop de joinSession invalides. Le sessionId est un UUID
// v4 généré côté PC (122 bits d'entropie) donc le brute-force est déjà hors de
// portée ; ceci protège plutôt contre le spam/scan.
const joinAttempts = new Map<string, JoinAttemptRecord>();

function registerFailedJoinAttempt(
  ip: string,
  existing?: JoinAttemptRecord,
): void {
  const count = (existing?.count ?? 0) + 1;
  const blockedUntil =
    count >= JOIN_MAX_ATTEMPTS ? Date.now() + JOIN_BLOCK_DURATION_MS : 0;
  joinAttempts.set(ip, { count, blockedUntil });
}

/**
 * Render (et la plupart des PaaS) mettent l'app derrière un proxy : l'IP TCP
 * vue par socket.io est celle du proxy, pas celle du client. On préfère donc
 * x-forwarded-for quand il est présent.
 */
function getClientIp(socket: SignalingSocket): string {
  const forwarded = socket.handshake.headers["x-forwarded-for"];
  if (typeof forwarded === "string" && forwarded.length > 0) {
    return forwarded.split(",")[0].trim();
  }
  return socket.handshake.address;
}

function roomForSocket(socketId: string): Room | undefined {
  const sessionId = socketSessions.get(socketId);
  return sessionId ? rooms.get(sessionId) : undefined;
}

function destroyRoom(sessionId: string, io: SignalingServer): void {
  const room = rooms.get(sessionId);
  if (!room) return;

  socketSessions.delete(room.hostSocketId);
  if (room.phoneSocketId) {
    socketSessions.delete(room.phoneSocketId);
    io.to(room.phoneSocketId).emit("peerLeft");
  }
  rooms.delete(sessionId);
}

function handleRegisterHost(
  socket: SignalingSocket,
  io: SignalingServer,
  sessionId: string,
): void {
  const existing = rooms.get(sessionId);

  if (existing && existing.hostSocketId !== socket.id) {
    // Reconnexion du PC (coupure réseau, redémarrage...) : on reprend la
    // room, mais la connexion P2P précédente est morte, donc le téléphone
    // devra rejoindre à nouveau pour renégocier.
    socketSessions.delete(existing.hostSocketId);
    if (existing.phoneSocketId) {
      socketSessions.delete(existing.phoneSocketId);
      io.to(existing.phoneSocketId).emit("peerLeft");
    }
  }

  rooms.set(sessionId, {
    sessionId,
    hostSocketId: socket.id,
    phoneSocketId: null,
  });
  socketSessions.set(socket.id, sessionId);
  socket.emit("hostRegistered");
}

function handleJoinSession(
  socket: SignalingSocket,
  io: SignalingServer,
  sessionId: string,
): void {
  const ip = getClientIp(socket);
  const now = Date.now();
  const record = joinAttempts.get(ip);

  if (record && record.blockedUntil > now) {
    socket.emit("joinError", { reason: "Too many attempts, try again later" });
    return;
  }

  const room = rooms.get(sessionId);
  if (!room) {
    registerFailedJoinAttempt(ip, record);
    socket.emit("joinError", { reason: "Session not found" });
    return;
  }

  if (record) joinAttempts.delete(ip);

  if (room.phoneSocketId && room.phoneSocketId !== socket.id) {
    socketSessions.delete(room.phoneSocketId);
  }

  room.phoneSocketId = socket.id;
  socketSessions.set(socket.id, sessionId);
  io.to(room.hostSocketId).emit("peerJoined");
}

function handleDisconnect(socket: SignalingSocket, io: SignalingServer): void {
  const sessionId = socketSessions.get(socket.id);
  if (!sessionId) return;

  const room = rooms.get(sessionId);
  if (!room) return;

  if (room.hostSocketId === socket.id) {
    destroyRoom(sessionId, io);
  } else if (room.phoneSocketId === socket.id) {
    room.phoneSocketId = null;
    socketSessions.delete(socket.id);
    io.to(room.hostSocketId).emit("peerLeft");
  }
}

function startServer(): void {
  const expressApp = express();

  // Ping de health check pour Render (limite les faux spin-down du free tier).
  expressApp.get("/health", (_req, res) => {
    res.status(200).json({ status: "ok", rooms: rooms.size });
  });

  const httpServer = createServer(expressApp);
  const io: SignalingServer = new Server(httpServer, {
    cors: { origin: "*" },
  });

  io.on("connection", (socket: SignalingSocket) => {
    socket.on("registerHost", ({ sessionId }) =>
      handleRegisterHost(socket, io, sessionId),
    );

    socket.on("joinSession", ({ sessionId }) =>
      handleJoinSession(socket, io, sessionId),
    );

    // offer/answer/iceCandidate ne sont que relayés tels quels à l'autre
    // socket de la room : le signaling ne comprend pas le SDP, il le transporte.
    socket.on("offer", ({ sdp }) => {
      const room = roomForSocket(socket.id);
      if (!room || room.hostSocketId !== socket.id || !room.phoneSocketId) {
        return;
      }
      io.to(room.phoneSocketId).emit("offer", { sdp });
    });

    socket.on("answer", ({ sdp }) => {
      const room = roomForSocket(socket.id);
      if (!room || room.phoneSocketId !== socket.id) return;
      io.to(room.hostSocketId).emit("answer", { sdp });
    });

    socket.on("iceCandidate", ({ candidate }) => {
      const room = roomForSocket(socket.id);
      if (!room) return;
      const targetSocketId =
        room.hostSocketId === socket.id ? room.phoneSocketId : room.hostSocketId;
      if (targetSocketId) {
        io.to(targetSocketId).emit("iceCandidate", { candidate });
      }
    });

    // Pas de heartbeat applicatif nécessaire : le ping/pong intégré de
    // socket.io déclenche déjà "disconnect" sur une coupure réseau silencieuse
    // (pas seulement sur une fermeture propre du socket).
    socket.on("disconnect", () => handleDisconnect(socket, io));
  });

  httpServer.listen(PORT, () => {
    console.log(`Glide signaling server listening on port ${PORT}`);
  });
}

startServer();
