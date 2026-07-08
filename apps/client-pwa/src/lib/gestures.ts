// Distance cumulée (px) à partir de laquelle un tap est requalifié en mouvement.
export const TAP_MOVE_THRESHOLD = 12;
// Durée max (ms) d'un tap pour qu'il soit considéré comme un clic.
export const TAP_MAX_DURATION = 300;
// Double-tap-and-hold (= drag) : délai max entre le relâchement du 1er tap et
// l'appui du 2e pour qu'ils soient considérés comme un double-tap.
export const DOUBLE_TAP_MAX_INTERVAL = 300;
// Distance max (px) entre les deux taps du double-tap.
export const DOUBLE_TAP_DISTANCE_THRESHOLD = 30;
// Durée (ms) que le 2e tap doit rester posé sans bouger avant que le drag démarre.
export const DRAG_HOLD_DELAY = 150;

// Au-delà de cette vitesse (px/event), le multiplicateur d'accélération est saturé.
const ACCEL_SPEED_DIVISOR = 40;
const ACCEL_MAX_BONUS = 1.5;

// Sensibilité de base + boost d'accélération pour les mouvements rapides.
export function applyAcceleration(dx: number, dy: number, sensitivity: number) {
  const magnitude = Math.hypot(dx, dy);
  const accelBonus = Math.min(magnitude / ACCEL_SPEED_DIVISOR, ACCEL_MAX_BONUS);
  const multiplier = sensitivity * (1 + accelBonus);
  return { x: dx * multiplier, y: dy * multiplier };
}
