/**
 * @param {number} x - Delta X movement
 * @param {number} y - Delta Y movement
 */
export interface MouseDeltaEvent {
  x: number;
  y: number;
}

export type ClickType = "left" | "right";

export type VolumeAction = "up" | "down";

/**
 * @param {string} pin - 6-digit PIN
 */
export interface AuthPayload {
  pin: string;
}

export interface ConnectionStatus {
  connected: boolean;
  serverAddress?: string;
}
