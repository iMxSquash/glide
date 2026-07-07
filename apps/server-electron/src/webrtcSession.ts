import { BrowserWindow, ipcMain } from "electron";
import { io as connectToSignaling, Socket as ClientSocket } from "socket.io-client";
import * as crypto from "crypto";
import * as path from "path";
import type {
  ControlChannelClientMessage,
  ControlChannelServerMessage,
  InputChannelMessage,
  SignalingClientToServerEvents,
  SignalingServerToClientEvents,
} from "@glide/shared-types";
import * as inputHandlers from "./inputHandlers";

const AUTH_MAX_ATTEMPTS = 5;
const AUTH_BLOCK_DURATION_MS = 5 * 60 * 1000;

type SignalingSocket = ClientSocket<
  SignalingServerToClientEvents,
  SignalingClientToServerEvents
>;

interface WebRtcHostDeps {
  /** URL of the signaling server, e.g. "https://glide-signaling.onrender.com". */
  signalingUrl: string;
  /** Always reads the *current* PIN (it can be regenerated). */
  getCurrentPin: () => string;
}

let sessionId = "";
let signalingUrl = "";
let getCurrentPin: (() => string) | null = null;
let signalingSocket: SignalingSocket | null = null;
let hiddenWindow: BrowserWindow | null = null;
let isAuthenticated = false;
let authAttempts = 0;
let authBlockedUntil = 0;
let isAccepting = true;
let ipcHandlersRegistered = false;

const peerStateListeners = new Set<(connected: boolean) => void>();
let isPeerConnected = false;

export function getSessionId(): string {
  return sessionId;
}

/**
 * Notified when a phone completes (or loses) PIN auth over the DataChannel.
 * Single WebRTC session in v1 : this is a 0/1 state, not a count.
 * @param {(connected: boolean) => void} listener Called on every state change
 * @returns {() => void} Unsubscribe function
 */
export function onPeerStateChange(listener: (connected: boolean) => void): () => void {
  peerStateListeners.add(listener);
  return () => peerStateListeners.delete(listener);
}

function setPeerConnected(connected: boolean): void {
  if (isPeerConnected === connected) return;
  isPeerConnected = connected;
  for (const listener of peerStateListeners) listener(connected);
}

function createHiddenWindow(): BrowserWindow {
  // Fenêtre jamais affichée : sert uniquement de contexte Chromium pour
  // exécuter l'API WebRTC native (RTCPeerConnection/DataChannel), absente du
  // main process Node. Voir assets/webrtc/renderer.js.
  const win = new BrowserWindow({
    show: false,
    webPreferences: {
      preload: path.join(__dirname, "..", "..", "assets", "webrtc", "preload.js"),
      contextIsolation: true,
      nodeIntegration: false,
    },
  });
  win.loadFile(path.join(__dirname, "..", "..", "assets", "webrtc", "index.html"));
  return win;
}

function sendControlMessage(message: ControlChannelServerMessage): void {
  hiddenWindow?.webContents.send("webrtc:send-control-message", message);
}

function resetAuth(): void {
  isAuthenticated = false;
  setPeerConnected(false);
}

function handleAuth(pin: string, currentPin: string): void {
  const now = Date.now();
  if (authBlockedUntil > now) {
    sendControlMessage({
      type: "authResult",
      success: false,
      reason: "Too many attempts, try again later",
    });
    return;
  }

  if (pin === currentPin) {
    isAuthenticated = true;
    authAttempts = 0;
    sendControlMessage({ type: "authResult", success: true });
    setPeerConnected(true);
    // Le volume affiché doit refléter l'état réel du PC dès la connexion, pas
    // seulement après le premier changement (sinon la PWA montre une valeur
    // par défaut fausse tant que l'utilisateur n'a pas touché au slider).
    inputHandlers
      .getVolumeState()
      .then((state) => sendControlMessage({ type: "volumeState", state }))
      .catch((error) => console.error("Failed to read initial volume state:", error));
    return;
  }

  authAttempts += 1;
  if (authAttempts >= AUTH_MAX_ATTEMPTS) {
    authBlockedUntil = now + AUTH_BLOCK_DURATION_MS;
  }
  sendControlMessage({ type: "authResult", success: false, reason: "Invalid PIN" });
}

function handleControlMessage(raw: unknown, currentPin: string): void {
  const message = raw as ControlChannelClientMessage;

  if (message.type === "auth") {
    handleAuth(message.pin, currentPin);
    return;
  }

  if (!isAuthenticated) return;

  switch (message.type) {
    case "leftClick":
      inputHandlers.leftClick();
      break;
    case "rightClick":
      inputHandlers.rightClick();
      break;
    case "mouseDown":
      inputHandlers.mouseDown();
      break;
    case "mouseUp":
      inputHandlers.mouseUp();
      break;
    case "typeText":
      inputHandlers.typeText(message.text);
      break;
    case "keyPress":
      inputHandlers.keyPress(message.key);
      break;
    case "volumeUp":
      inputHandlers.volumeUp();
      break;
    case "volumeDown":
      inputHandlers.volumeDown();
      break;
    case "setVolume":
      inputHandlers.setVolume(message.value);
      break;
    case "toggleMute":
      inputHandlers.toggleMute();
      break;
  }
}

function handleInputMessage(raw: unknown): void {
  if (!isAuthenticated) return;

  const message = raw as InputChannelMessage;
  switch (message.type) {
    case "mouseDelta":
      inputHandlers.accumulateMouseDelta(message.delta);
      break;
    case "scroll":
      inputHandlers.accumulateScroll(message.delta);
      break;
  }
}

function registerIpcHandlers(): void {
  if (ipcHandlersRegistered) return;
  ipcHandlersRegistered = true;

  ipcMain.on("webrtc:local-offer", (_event, { sdp }) => {
    signalingSocket?.emit("offer", { sdp });
  });

  ipcMain.on("webrtc:local-ice-candidate", (_event, { candidate }) => {
    signalingSocket?.emit("iceCandidate", { candidate });
  });

  ipcMain.on("webrtc:datachannel-closed", (_event, { channel }) => {
    if (channel !== "control") return;
    resetAuth();
    // Sécurité : si le canal control ferme pendant un drag, le bouton gauche
    // resterait sinon pressé indéfiniment sur le PC (même filet de sécurité
    // que sur peerLeft et peer-connection-failed).
    inputHandlers.releaseMouseButtonSafely();
  });

  ipcMain.on("webrtc:peer-connection-failed", () => {
    resetAuth();
    inputHandlers.releaseMouseButtonSafely();
  });

  ipcMain.on("webrtc:datachannel-message", (_event, { channel, message }) => {
    if (!getCurrentPin) return;
    if (channel === "control") handleControlMessage(message, getCurrentPin());
    else if (channel === "input") handleInputMessage(message);
  });
}

function connectSignaling(): void {
  signalingSocket = connectToSignaling(signalingUrl, {
    transports: ["websocket"],
  });

  signalingSocket.on("connect", () => {
    // Refait à chaque (re)connexion, y compris après une coupure internet :
    // c'est exactement le "re-register avec le même sessionId" voulu.
    signalingSocket?.emit("registerHost", { sessionId });
  });

  signalingSocket.on("hostRegistered", () => {
    console.log(`WebRTC signaling: host registered (session ${sessionId})`);
  });

  signalingSocket.on("peerJoined", () => {
    resetAuth();
    hiddenWindow?.webContents.send("webrtc:start-as-host");
  });

  signalingSocket.on("peerLeft", () => {
    resetAuth();
    hiddenWindow?.webContents.send("webrtc:close-peer");
    inputHandlers.releaseMouseButtonSafely();
  });

  signalingSocket.on("answer", ({ sdp }) => {
    hiddenWindow?.webContents.send("webrtc:remote-answer", { sdp });
  });

  signalingSocket.on("iceCandidate", ({ candidate }) => {
    hiddenWindow?.webContents.send("webrtc:remote-ice-candidate", { candidate });
  });

  signalingSocket.on("joinError", ({ reason }) => {
    console.warn("WebRTC signaling: join error", reason);
  });
}

/**
 * Pauses/resumes accepting connections: mirrors the LAN mode's "Pause
 * Server". While paused, the signaling connection is dropped entirely (the
 * session room is destroyed server-side), so a phone can't join ; resuming
 * reconnects and re-registers the *same* session id (the already-displayed
 * QR code stays valid).
 * @param {boolean} accepting Whether new connections should be accepted
 */
export function setAccepting(accepting: boolean): void {
  isAccepting = accepting;
  if (!accepting) {
    hiddenWindow?.webContents.send("webrtc:close-peer");
    resetAuth();
    signalingSocket?.disconnect();
    signalingSocket = null;
  } else if (signalingUrl) {
    connectSignaling();
  }
}

export function isAcceptingConnections(): boolean {
  return isAccepting;
}

/**
 * Connects (outbound) to the signaling server and registers this PC as a
 * WebRTC host under a fresh, unguessable session id.
 */
export function startWebRtcHost(deps: WebRtcHostDeps): void {
  sessionId = crypto.randomUUID();
  signalingUrl = deps.signalingUrl;
  getCurrentPin = deps.getCurrentPin;
  hiddenWindow = createHiddenWindow();
  registerIpcHandlers();

  // Attend que le renderer ait fini de charger avant d'ouvrir la connexion
  // signaling : renderer.js enregistre l'écouteur IPC webrtc:start-as-host de
  // façon synchrone au chargement de la page, mais ce chargement est async
  // (loadFile). Sans cette attente, un peerJoined assez rapide pourrait
  // arriver avant que le renderer soit prêt à le recevoir : webContents.send
  // ne fait pas de queueing, le message serait perdu silencieusement.
  hiddenWindow.webContents.once("did-finish-load", () => {
    connectSignaling();
  });

  inputHandlers.onVolumeChange((state) => {
    if (isAuthenticated) sendControlMessage({ type: "volumeState", state });
  });

  inputHandlers.startMouseTickLoop();
}
