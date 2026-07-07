import { useCallback, useEffect, useRef, useState } from "react";
import { io, Socket } from "socket.io-client";
import type {
  ControlChannelClientMessage,
  ControlChannelServerMessage,
  InputChannelMessage,
  SignalingClientToServerEvents,
  SignalingServerToClientEvents,
  VolumeState,
} from "@glide/shared-types";

// Room encore présente mais le PC (host) n'a pas rejoint : on retente
// joinSession à cadence fixe plutôt qu'une seule fois, car le host peut
// mettre du temps à reconnecter son propre socket de signaling.
const REJOIN_RETRY_INTERVAL_MS = 3000;

export type ConnectionStatus = "idle" | "connecting" | "connected" | "reconnecting" | "error";

type SignalingSocket = Socket<SignalingServerToClientEvents, SignalingClientToServerEvents>;

interface UseGlideConnectionOptions {
  signalingUrl: string;
}

interface UseGlideConnection {
  status: ConnectionStatus;
  errorMessage: string | null;
  volume: VolumeState;
  connect: (sessionId: string, pin: string) => void;
  disconnect: () => void;
  sendControl: (message: ControlChannelClientMessage) => void;
  sendInput: (message: InputChannelMessage) => void;
}

const IDLE_VOLUME_STATE: VolumeState = { volume: 50, muted: false };

/**
 * Owns the WebRTC transport to the PC: joins the signaling room, negotiates
 * the peer connection (phone is always the answerer, the PC always offers),
 * authenticates over the `control` DataChannel, and exposes send/receive
 * primitives. UI/persistence concerns stay in the caller.
 */
export function useGlideConnection({
  signalingUrl,
}: UseGlideConnectionOptions): UseGlideConnection {
  const [status, setStatus] = useState<ConnectionStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [volume, setVolume] = useState<VolumeState>(IDLE_VOLUME_STATE);

  const signalingRef = useRef<SignalingSocket | null>(null);
  const pcRef = useRef<RTCPeerConnection | null>(null);
  const controlChannelRef = useRef<RTCDataChannel | null>(null);
  const inputChannelRef = useRef<RTCDataChannel | null>(null);
  const sessionIdRef = useRef<string>("");
  const pinRef = useRef<string>("");
  // true once auth has ever succeeded for the current connect() call: decides
  // whether a dropped peer connection retries silently (reconnecting) or
  // surfaces an error (never got through in the first place).
  const hasAuthenticatedRef = useRef(false);
  const rejoinTimerRef = useRef<number | null>(null);

  const clearRejoinTimer = useCallback(() => {
    if (rejoinTimerRef.current !== null) {
      window.clearInterval(rejoinTimerRef.current);
      rejoinTimerRef.current = null;
    }
  }, []);

  const closePeer = useCallback(() => {
    inputChannelRef.current?.close();
    inputChannelRef.current = null;
    controlChannelRef.current?.close();
    controlChannelRef.current = null;
    pcRef.current?.close();
    pcRef.current = null;
  }, []);

  const scheduleRejoin = useCallback(() => {
    clearRejoinTimer();
    rejoinTimerRef.current = window.setInterval(() => {
      if (signalingRef.current?.connected) {
        signalingRef.current.emit("joinSession", { sessionId: sessionIdRef.current });
      }
    }, REJOIN_RETRY_INTERVAL_MS);
  }, [clearRejoinTimer]);

  const handleConnectionLost = useCallback(() => {
    closePeer();
    if (hasAuthenticatedRef.current) {
      setStatus("reconnecting");
      scheduleRejoin();
    } else {
      clearRejoinTimer();
      setStatus("error");
      setErrorMessage(
        "Impossible d'établir la connexion avec le PC. Vérifie que Glide est lancé et que les deux appareils sont sur le même WiFi.",
      );
    }
  }, [closePeer, scheduleRejoin, clearRejoinTimer]);

  const setupControlChannel = useCallback(
    (channel: RTCDataChannel) => {
      controlChannelRef.current = channel;
      channel.onopen = () => {
        const authMessage: ControlChannelClientMessage = { type: "auth", pin: pinRef.current };
        channel.send(JSON.stringify(authMessage));
      };
      channel.onmessage = (event) => {
        const message = JSON.parse(event.data) as ControlChannelServerMessage;
        if (message.type === "authResult") {
          if (message.success) {
            hasAuthenticatedRef.current = true;
            clearRejoinTimer();
            setErrorMessage(null);
            setStatus("connected");
          } else {
            clearRejoinTimer();
            setErrorMessage(message.reason ?? "Authentication failed");
            setStatus("error");
            closePeer();
            signalingRef.current?.disconnect();
            signalingRef.current = null;
          }
        } else if (message.type === "volumeState") {
          setVolume(message.state);
        }
      };
    },
    [clearRejoinTimer, closePeer],
  );

  const setupInputChannel = useCallback((channel: RTCDataChannel) => {
    inputChannelRef.current = channel;
  }, []);

  const connect = useCallback(
    (sessionId: string, pin: string) => {
      closePeer();
      clearRejoinTimer();
      signalingRef.current?.disconnect();

      sessionIdRef.current = sessionId;
      pinRef.current = pin;
      hasAuthenticatedRef.current = false;
      setErrorMessage(null);
      setVolume(IDLE_VOLUME_STATE);
      setStatus("connecting");

      const signaling: SignalingSocket = io(signalingUrl, { transports: ["websocket"] });
      signalingRef.current = signaling;

      // Re-emitted on every "connect", including automatic reconnects: if the
      // phone's own signaling socket drops and comes back, it must rejoin the
      // room again (a fresh socket.id no longer matches the room's record).
      signaling.on("connect", () => {
        signaling.emit("joinSession", { sessionId: sessionIdRef.current });
      });

      signaling.on("joinError", ({ reason }) => {
        clearRejoinTimer();
        setStatus("error");
        setErrorMessage(
          reason === "Session not found"
            ? "PC introuvable. Vérifie que Glide est lancé sur le PC et rescanne le QR code."
            : reason,
        );
      });

      signaling.on("offer", async ({ sdp }) => {
        closePeer();
        // Pas de STUN/TURN : PC et téléphone sont attendus sur le même LAN,
        // les host candidates suffisent (hors-LAN est un besoin v2).
        const pc = new RTCPeerConnection({ iceServers: [] });
        pcRef.current = pc;

        pc.onicecandidate = (event) => {
          if (event.candidate) {
            signaling.emit("iceCandidate", { candidate: event.candidate.toJSON() });
          }
        };

        // Le PC crée toujours les DataChannels (il émet l'offer) : le
        // téléphone les reçoit ici plutôt que d'en créer lui-même.
        pc.ondatachannel = (event) => {
          if (event.channel.label === "control") setupControlChannel(event.channel);
          else if (event.channel.label === "input") setupInputChannel(event.channel);
        };

        pc.onconnectionstatechange = () => {
          if (pc.connectionState === "failed" || pc.connectionState === "closed") {
            handleConnectionLost();
          }
        };

        try {
          await pc.setRemoteDescription(sdp);
          const answer = await pc.createAnswer();
          await pc.setLocalDescription(answer);
          signaling.emit("answer", { sdp: pc.localDescription!.toJSON() });
        } catch (err) {
          console.error("Failed to negotiate WebRTC offer", err);
          handleConnectionLost();
        }
      });

      signaling.on("iceCandidate", ({ candidate }) => {
        pcRef.current?.addIceCandidate(candidate).catch((err) => {
          console.error("Failed to add remote ICE candidate", err);
        });
      });

      // Le PC s'est déconnecté du signaling (fermeture app, coupure réseau) :
      // la room est détruite côté serveur, il faudra rejoindre à nouveau une
      // fois le PC revenu.
      signaling.on("peerLeft", handleConnectionLost);

      // Pas de handler connect_error : le signaling (Render free tier) peut
      // mettre jusqu'à ~1 min à se réveiller après une inactivité,
      // socket.io-client réessaie tout seul (reconnection activée par
      // défaut) sans qu'on ait besoin d'afficher une erreur prématurée.
    },
    [signalingUrl, closePeer, clearRejoinTimer, handleConnectionLost, setupControlChannel, setupInputChannel],
  );

  const disconnect = useCallback(() => {
    clearRejoinTimer();
    closePeer();
    signalingRef.current?.disconnect();
    signalingRef.current = null;
    setStatus("idle");
    setErrorMessage(null);
  }, [clearRejoinTimer, closePeer]);

  useEffect(() => () => disconnect(), [disconnect]);

  const sendControl = useCallback((message: ControlChannelClientMessage) => {
    const channel = controlChannelRef.current;
    if (channel?.readyState === "open") channel.send(JSON.stringify(message));
  }, []);

  const sendInput = useCallback((message: InputChannelMessage) => {
    const channel = inputChannelRef.current;
    if (channel?.readyState === "open") channel.send(JSON.stringify(message));
  }, []);

  return { status, errorMessage, volume, connect, disconnect, sendControl, sendInput };
}
