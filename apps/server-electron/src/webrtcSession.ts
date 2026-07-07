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
let signalingSocket: SignalingSocket | null = null;
let hiddenWindow: BrowserWindow | null = null;
let isAuthenticated = false;
let authAttempts = 0;
let authBlockedUntil = 0;
let ipcHandlersRegistered = false;

export function getSessionId(): string {
  return sessionId;
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

function registerIpcHandlers(getCurrentPin: () => string): void {
  if (ipcHandlersRegistered) return;
  ipcHandlersRegistered = true;

  ipcMain.on("webrtc:local-offer", (_event, { sdp }) => {
    signalingSocket?.emit("offer", { sdp });
  });

  ipcMain.on("webrtc:local-ice-candidate", (_event, { candidate }) => {
    signalingSocket?.emit("iceCandidate", { candidate });
  });

  ipcMain.on("webrtc:datachannel-closed", (_event, { channel }) => {
    if (channel === "control") resetAuth();
  });

  ipcMain.on("webrtc:peer-connection-failed", () => {
    resetAuth();
    inputHandlers.releaseMouseButtonSafely();
  });

  ipcMain.on("webrtc:datachannel-message", (_event, { channel, message }) => {
    if (channel === "control") handleControlMessage(message, getCurrentPin());
    else if (channel === "input") handleInputMessage(message);
  });
}

/**
 * Connects (outbound) to the signaling server and registers this PC as a
 * WebRTC host under a fresh, unguessable session id. Additive to the
 * existing LAN direct mode : both can run at the same time, nothing here
 * touches the HTTPS/socket.io server in main.ts.
 */
export function startWebRtcHost(deps: WebRtcHostDeps): void {
  sessionId = crypto.randomUUID();
  hiddenWindow = createHiddenWindow();
  registerIpcHandlers(deps.getCurrentPin);

  signalingSocket = connectToSignaling(deps.signalingUrl, {
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

  inputHandlers.onVolumeChange((state) => {
    if (isAuthenticated) sendControlMessage({ type: "volumeState", state });
  });

  inputHandlers.startMouseTickLoop();
}
