export interface Delta2D {
  x: number;
  y: number;
}

export interface VolumeState {
  volume: number;
  muted: boolean;
}

/**
 * @param {string} pin - 6-digit PIN, sent as socket.io `auth` on connect
 */
export interface AuthPayload {
  pin: string;
}

/** Events emitted by the client (phone), handled by the server (PC). */
export interface ClientToServerEvents {
  mouseDelta: (delta: Delta2D) => void;
  scroll: (delta: Delta2D) => void;
  leftClick: () => void;
  rightClick: () => void;
  mouseDown: () => void;
  mouseUp: () => void;
  typeText: (text: string) => void;
  keyPress: (key: "Enter" | "Backspace") => void;
  volumeUp: () => void;
  volumeDown: () => void;
  setVolume: (value: number) => void;
  toggleMute: () => void;
}

/** Events emitted by the server (PC), handled by the client (phone). */
export interface ServerToClientEvents {
  volumeState: (state: VolumeState) => void;
}
