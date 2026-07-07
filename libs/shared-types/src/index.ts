export interface Delta2D {
  x: number;
  y: number;
}

export interface VolumeState {
  volume: number;
  muted: boolean;
}

// ---------------------------------------------------------------------------
// WebRTC signaling (apps/signaling): pairs a PC and a phone on the same LAN
// so they can negotiate a direct P2P DataChannel. The signaling server only
// relays SDP/ICE between the two sockets of a room ; it never sees the PIN
// or any input event. See TODO.md "Mise en ligne" for the full architecture.
// ---------------------------------------------------------------------------

/** Events emitted by a PC or a phone, handled by the signaling server. */
export interface SignalingClientToServerEvents {
  /** PC only: creates (or reclaims, after a reconnect) the room for this session. */
  registerHost: (payload: { sessionId: string }) => void;
  /** Phone only: joins the room created by the PC. */
  joinSession: (payload: { sessionId: string }) => void;
  /** Relayed as-is to the other socket in the room. */
  offer: (payload: { sdp: RTCSessionDescriptionInit }) => void;
  answer: (payload: { sdp: RTCSessionDescriptionInit }) => void;
  iceCandidate: (payload: { candidate: RTCIceCandidateInit }) => void;
}

/** Events emitted by the signaling server, handled by a PC or a phone. */
export interface SignalingServerToClientEvents {
  /** PC only: registerHost succeeded, the room is ready to be joined. */
  hostRegistered: () => void;
  /** Phone only: joinSession failed (unknown/stale sessionId, room full). */
  joinError: (payload: { reason: string }) => void;
  /** PC only: a phone joined the room, start the WebRTC offer/answer flow. */
  peerJoined: () => void;
  /** Both: the other party disconnected from the room. */
  peerLeft: () => void;
  /** Relayed as-is from the other socket in the room. */
  offer: (payload: { sdp: RTCSessionDescriptionInit }) => void;
  answer: (payload: { sdp: RTCSessionDescriptionInit }) => void;
  iceCandidate: (payload: { candidate: RTCIceCandidateInit }) => void;
}

// ---------------------------------------------------------------------------
// WebRTC DataChannel protocol: once the P2P connection is up, the phone and
// the PC exchange JSON messages directly (no socket.io on this path). Two
// channels: `control` (reliable, ordered) and `input` (unreliable,
// unordered ; a lost mouseDelta/scroll frame is superseded by the next one).
// ---------------------------------------------------------------------------

/** `control` channel messages sent by the phone, handled by the PC. */
export type ControlChannelClientMessage =
  | { type: "auth"; pin: string }
  | { type: "leftClick" }
  | { type: "rightClick" }
  | { type: "mouseDown" }
  | { type: "mouseUp" }
  | { type: "typeText"; text: string }
  | { type: "keyPress"; key: "Enter" | "Backspace" }
  | { type: "volumeUp" }
  | { type: "volumeDown" }
  | { type: "setVolume"; value: number }
  | { type: "toggleMute" };

/** `control` channel messages sent by the PC, handled by the phone. */
export type ControlChannelServerMessage =
  | { type: "authResult"; success: boolean; reason?: string }
  | { type: "volumeState"; state: VolumeState };

/** `input` channel messages, phone to PC only. */
export type InputChannelMessage =
  | { type: "mouseDelta"; delta: Delta2D }
  | { type: "scroll"; delta: Delta2D };
