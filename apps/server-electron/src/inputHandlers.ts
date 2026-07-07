import { mouse, keyboard, Button, Key } from "@nut-tree-fork/nut-js";
import loudness from "loudness";
import type { Delta2D, VolumeState } from "@glide/shared-types";

const MOUSE_TICK_HZ = 120;
// L'unité de scrollUp/Down/Left/Right est OS-dépendante, pas le pixel : les
// deltas 2 doigts sont accumulés en pixels puis convertis en "steps".
const SCROLL_PIXELS_PER_STEP = 1;

// Deltas de souris accumulés entre deux ticks, appliqués en un seul setPosition
// (au lieu d'un aller-retour getPosition/setPosition par message reçu, qui sature
// nut-js et fait sauter/ramer le curseur).
let pendingMouseDelta: Delta2D = { x: 0, y: 0 };
let cursorPosition: { x: number; y: number } | null = null;
let isApplyingMousePosition = false;

let pendingScrollDelta: Delta2D = { x: 0, y: 0 };

// Souris/clavier/volume sont des ressources uniques du PC, partagées par tous
// les transports actifs (LAN direct et/ou WebRTC) : la boucle de tick ne doit
// tourner qu'une seule fois, peu importe combien de transports l'ont démarrée.
let tickLoopStarted = false;

const volumeChangeListeners = new Set<(state: VolumeState) => void>();

/**
 * S'abonne aux changements de volume (déclenchés par n'importe quel
 * transport). Retourne une fonction de désabonnement.
 * @param {(state: VolumeState) => void} listener Called on every volume change
 * @returns {() => void} Unsubscribe function
 */
export function onVolumeChange(listener: (state: VolumeState) => void): () => void {
  volumeChangeListeners.add(listener);
  return () => volumeChangeListeners.delete(listener);
}

export function accumulateMouseDelta(delta: Delta2D): void {
  pendingMouseDelta.x += delta.x;
  pendingMouseDelta.y += delta.y;
}

export function accumulateScroll(delta: Delta2D): void {
  pendingScrollDelta.x += delta.x;
  pendingScrollDelta.y += delta.y;
}

async function applyPendingScroll(): Promise<void> {
  const stepsY = Math.trunc(pendingScrollDelta.y / SCROLL_PIXELS_PER_STEP);
  const stepsX = Math.trunc(pendingScrollDelta.x / SCROLL_PIXELS_PER_STEP);
  if (stepsY === 0 && stepsX === 0) return;

  // Le reste (< 1 step) est conservé pour le prochain tick, sinon les petits
  // mouvements de scroll s'accumulent puis se perdent (curseur qui "colle").
  pendingScrollDelta.y -= stepsY * SCROLL_PIXELS_PER_STEP;
  pendingScrollDelta.x -= stepsX * SCROLL_PIXELS_PER_STEP;

  if (stepsY > 0) await mouse.scrollDown(stepsY);
  else if (stepsY < 0) await mouse.scrollUp(-stepsY);

  if (stepsX > 0) await mouse.scrollRight(stepsX);
  else if (stepsX < 0) await mouse.scrollLeft(-stepsX);
}

/**
 * Starts the shared mouse/scroll tick loop. Safe to call from multiple
 * transports : only the first call actually starts the interval.
 */
export function startMouseTickLoop(): void {
  if (tickLoopStarted) return;
  tickLoopStarted = true;

  setInterval(async () => {
    await applyPendingScroll();

    if (isApplyingMousePosition) return;

    if (pendingMouseDelta.x === 0 && pendingMouseDelta.y === 0) {
      // Rien à appliquer : on invalide la position mise en cache pour se
      // resynchroniser avec la position réelle au prochain mouvement (au cas
      // où le curseur ait été déplacé par autre chose entre-temps).
      cursorPosition = null;
      return;
    }

    const delta = pendingMouseDelta;
    pendingMouseDelta = { x: 0, y: 0 };
    isApplyingMousePosition = true;
    try {
      if (!cursorPosition) {
        cursorPosition = await mouse.getPosition();
      }
      cursorPosition = {
        x: cursorPosition.x + delta.x,
        y: cursorPosition.y + delta.y,
      };
      await mouse.setPosition(cursorPosition);
    } finally {
      isApplyingMousePosition = false;
    }
  }, 1000 / MOUSE_TICK_HZ);
}

export async function leftClick(): Promise<void> {
  await mouse.leftClick();
}

export async function rightClick(): Promise<void> {
  await mouse.rightClick();
}

export async function mouseDown(): Promise<void> {
  await mouse.pressButton(Button.LEFT);
}

export async function mouseUp(): Promise<void> {
  await mouse.releaseButton(Button.LEFT);
}

/**
 * Sécurité : si une connexion coupe pendant un drag (WiFi, verrouillage
 * écran...), le bouton gauche resterait sinon pressé indéfiniment sur le PC.
 */
export async function releaseMouseButtonSafely(): Promise<void> {
  await mouse.releaseButton(Button.LEFT).catch(() => {});
}

export async function typeText(text: string): Promise<void> {
  if (typeof text === "string" && text.length > 0) {
    await keyboard.type(text);
  }
}

export async function keyPress(key: "Enter" | "Backspace"): Promise<void> {
  if (key === "Enter") await keyboard.type(Key.Enter);
  else if (key === "Backspace") await keyboard.type(Key.Backspace);
}

/**
 * @returns {VolumeState} Real system volume, read via the `loudness` lib (not
 * a locally-guessed counter).
 */
export async function getVolumeState(): Promise<VolumeState> {
  const [volume, muted] = await Promise.all([
    loudness.getVolume(),
    loudness.getMuted(),
  ]);
  return { volume, muted };
}

async function broadcastVolumeState(): Promise<void> {
  try {
    const state = await getVolumeState();
    for (const listener of volumeChangeListeners) listener(state);
  } catch (error) {
    console.error("Failed to read system volume:", error);
  }
}

export async function volumeUp(): Promise<void> {
  const current = await loudness.getVolume();
  await loudness.setVolume(Math.min(100, current + 10));
  await broadcastVolumeState();
}

export async function volumeDown(): Promise<void> {
  const current = await loudness.getVolume();
  await loudness.setVolume(Math.max(0, current - 10));
  await broadcastVolumeState();
}

export async function setVolume(value: number): Promise<void> {
  await loudness.setVolume(Math.max(0, Math.min(100, Math.round(value))));
  await broadcastVolumeState();
}

export async function toggleMute(): Promise<void> {
  const muted = await loudness.getMuted();
  await loudness.setMuted(!muted);
  await broadcastVolumeState();
}
