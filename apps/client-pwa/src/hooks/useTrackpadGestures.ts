import { useEffect, useRef, useState } from "react";
import type { ControlChannelClientMessage, InputChannelMessage } from "@glide/shared-types";
import {
  DOUBLE_TAP_DISTANCE_THRESHOLD,
  DOUBLE_TAP_MAX_INTERVAL,
  DRAG_HOLD_DELAY,
  TAP_MAX_DURATION,
  TAP_MOVE_THRESHOLD,
  applyAcceleration,
} from "../lib/gestures";

interface PointerState {
  id: number;
  x: number;
  y: number;
}

interface UseTrackpadGesturesOptions {
  sensitivity: number;
  invertScroll: boolean;
  sendInput: (message: InputChannelMessage) => void;
  sendControl: (message: ControlChannelClientMessage) => void;
}

/**
 * Owns the trackpad's pointer/gesture state machine: 1-finger move/tap,
 * 2-finger scroll/right-click, and double-tap-and-hold to drag. UI concerns
 * (App/Trackpad) only see the resulting click feedback and drag flags.
 */
export function useTrackpadGestures({
  sensitivity,
  invertScroll,
  sendInput,
  sendControl,
}: UseTrackpadGesturesOptions) {
  const sensitivityRef = useRef(sensitivity);
  const invertScrollRef = useRef(invertScroll);
  const trackpadRef = useRef<HTMLDivElement>(null);
  const pointersRef = useRef<Map<number, PointerState>>(new Map());
  const lastPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  // Timestamp du début du geste (posé par le 1er doigt), utilisé pour les taps 1 doigt.
  const gestureStartTimeRef = useRef<number>(0);
  // Timestamp par doigt, utilisé pour mesurer la durée réelle d'un tap 2 doigts
  // (le doigt le plus récent, pas le 1er qui peut être posé depuis longtemps).
  const pointerDownTimesRef = useRef<Map<number, number>>(new Map());
  // Position de départ par doigt, pour mesurer la distance cumulée (tap vs move).
  const pointerStartPosRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  const hasMovedRef = useRef<boolean>(false);
  // Empêche un 2e pointerup du même geste d'émettre un clic supplémentaire.
  const gestureHandledRef = useRef<boolean>(false);
  // Deltas accumulés en attente d'être envoyés au prochain tick rAF.
  const pendingDeltaRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  // Position par doigt pendant un geste à 2 doigts (scroll), pour calculer le
  // delta entre deux pointermove successifs de ce doigt.
  const twoFingerPosRef = useRef<Map<number, { x: number; y: number }>>(new Map());
  // Deltas de scroll accumulés en attente d'être envoyés au prochain tick rAF.
  const pendingScrollRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  // Dernier tap 1 doigt relâché (heure + position), pour détecter un double-tap.
  const lastTapUpRef = useRef<{ time: number; x: number; y: number } | null>(null);
  const dragHoldTimerRef = useRef<number | null>(null);
  const isDraggingRef = useRef(false);
  const [isDraggingUI, setIsDraggingUI] = useState(false);
  const [clickPulse, setClickPulse] = useState(false);

  useEffect(() => {
    sensitivityRef.current = sensitivity;
  }, [sensitivity]);

  useEffect(() => {
    invertScrollRef.current = invertScroll;
  }, [invertScroll]);

  // Envoie les deltas accumulés au serveur à cadence fixe (~60 Hz max) au lieu
  // d'un event par pointermove, pour éviter de flooder le DataChannel.
  useEffect(() => {
    let rafId: number;
    const flush = () => {
      const pending = pendingDeltaRef.current;
      if (pending.x !== 0 || pending.y !== 0) {
        sendInput({ type: "mouseDelta", delta: { x: pending.x, y: pending.y } });
        pendingDeltaRef.current = { x: 0, y: 0 };
      }
      const pendingScroll = pendingScrollRef.current;
      if (pendingScroll.x !== 0 || pendingScroll.y !== 0) {
        sendInput({ type: "scroll", delta: { x: pendingScroll.x, y: pendingScroll.y } });
        pendingScrollRef.current = { x: 0, y: 0 };
      }
      rafId = requestAnimationFrame(flush);
    };
    rafId = requestAnimationFrame(flush);
    return () => cancelAnimationFrame(rafId);
  }, [sendInput]);

  const triggerClickFeedback = () => {
    navigator.vibrate?.(10);
    setClickPulse(true);
    window.setTimeout(() => setClickPulse(false), 150);
  };

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const rect = trackpadRef.current?.getBoundingClientRect();
    if (!rect) return;

    const now = Date.now();
    const clientX = e.nativeEvent.clientX;
    const clientY = e.nativeEvent.clientY;

    pointersRef.current.set(e.pointerId, {
      id: e.pointerId,
      x: clientX - rect.left,
      y: clientY - rect.top,
    });
    pointerDownTimesRef.current.set(e.pointerId, now);
    pointerStartPosRef.current.set(e.pointerId, { x: clientX, y: clientY });
    // Position de départ pour le calcul de delta de scroll à 2 doigts.
    twoFingerPosRef.current.set(e.pointerId, { x: clientX, y: clientY });

    trackpadRef.current?.setPointerCapture(e.pointerId);

    if (pointersRef.current.size === 1) {
      lastPosRef.current = { x: clientX, y: clientY };
      gestureStartTimeRef.current = now;
      hasMovedRef.current = false;
      gestureHandledRef.current = false;

      // Double-tap-and-hold = drag : si ce doigt se pose vite et près du
      // dernier tap relâché, et qu'il reste posé sans bouger, on démarre un
      // drag (mouse.pressButton côté serveur).
      const lastTap = lastTapUpRef.current;
      if (
        lastTap &&
        now - lastTap.time < DOUBLE_TAP_MAX_INTERVAL &&
        Math.hypot(clientX - lastTap.x, clientY - lastTap.y) <
          DOUBLE_TAP_DISTANCE_THRESHOLD
      ) {
        const pointerId = e.pointerId;
        dragHoldTimerRef.current = window.setTimeout(() => {
          dragHoldTimerRef.current = null;
          if (
            pointersRef.current.size === 1 &&
            pointersRef.current.has(pointerId) &&
            !hasMovedRef.current
          ) {
            isDraggingRef.current = true;
            setIsDraggingUI(true);
            navigator.vibrate?.(20);
            sendControl({ type: "mouseDown" });
          }
        }, DRAG_HOLD_DELAY);
      }
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();

    // Distance cumulée depuis le pointerdown de ce doigt (pas le delta par event)
    // pour ne pas confondre un tap qui bouge naturellement avec un vrai mouvement.
    const startPos = pointerStartPosRef.current.get(e.pointerId);
    if (startPos) {
      const totalDx = e.nativeEvent.clientX - startPos.x;
      const totalDy = e.nativeEvent.clientY - startPos.y;
      if (Math.hypot(totalDx, totalDy) > TAP_MOVE_THRESHOLD) {
        // Un vrai mouvement annule un drag en attente de confirmation (le
        // doigt bouge au lieu de rester posé pour déclencher le hold).
        if (!hasMovedRef.current && dragHoldTimerRef.current !== null) {
          window.clearTimeout(dragHoldTimerRef.current);
          dragHoldTimerRef.current = null;
        }
        hasMovedRef.current = true;
      }
    }

    // Scroll à 2 doigts : chaque doigt fait avancer le scroll de son propre
    // delta (divisé par 2 car les deux doigts bougent ensemble), au lieu de
    // déplacer le curseur.
    if (pointersRef.current.size === 2) {
      const prev = twoFingerPosRef.current.get(e.pointerId);
      const cx = e.nativeEvent.clientX;
      const cy = e.nativeEvent.clientY;
      if (prev) {
        // Convention "natural scrolling" : le contenu suit le doigt (inversable
        // dans les paramètres pour ceux qui préfèrent la convention "classique").
        // Multiplié par la sensibilité comme le curseur, sinon le scroll reste
        // logé à un delta pixel brut alors que le curseur est bien plus rapide
        // (sensibilité par défaut 2x) et le scroll paraît beaucoup trop léger.
        const invert = invertScrollRef.current ? -1 : 1;
        const scale = (invert * sensitivityRef.current) / 2;
        pendingScrollRef.current.x += (prev.x - cx) * scale;
        pendingScrollRef.current.y += (prev.y - cy) * scale;
      }
      twoFingerPosRef.current.set(e.pointerId, { x: cx, y: cy });
      return;
    }

    if (pointersRef.current.size !== 1) return;

    // getCoalescedEvents() récupère les positions intermédiaires que le navigateur
    // compresse en un seul pointermove à haute vitesse (sinon perdues entre 2 frames).
    const nativeEvent = e.nativeEvent;
    const coalesced =
      typeof nativeEvent.getCoalescedEvents === "function"
        ? nativeEvent.getCoalescedEvents()
        : [];
    const events = coalesced.length > 0 ? coalesced : [nativeEvent];

    let sumX = 0;
    let sumY = 0;
    let last = lastPosRef.current;
    for (const ev of events) {
      sumX += ev.clientX - last.x;
      sumY += ev.clientY - last.y;
      last = { x: ev.clientX, y: ev.clientY };
    }
    lastPosRef.current = last;

    // Tout envoyer (plus de seuil ici) : le seuil de tap-vs-move est géré
    // séparément par TAP_MOVE_THRESHOLD, sinon les petits mouvements précis
    // sont perdus et le curseur "colle".
    const { x, y } = applyAcceleration(sumX, sumY, sensitivityRef.current);
    pendingDeltaRef.current.x += x;
    pendingDeltaRef.current.y += y;
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const wasSingleTouch = pointersRef.current.size === 1;
    const wasTwoTouches = pointersRef.current.size === 2;
    const wasDragging = isDraggingRef.current;

    // Tap 1 doigt : durée mesurée depuis que CE doigt a touché l'écran.
    // Tap 2 doigts : durée mesurée depuis le doigt le plus récent (pas le 1er,
    // qui peut être posé depuis longtemps si l'utilisateur bougeait déjà la souris).
    const now = Date.now();
    const thisPointerDownTime =
      pointerDownTimesRef.current.get(e.pointerId) ?? gestureStartTimeRef.current;
    const latestPointerDownTime = Math.max(
      ...Array.from(pointerDownTimesRef.current.values()),
      thisPointerDownTime,
    );
    const tapDuration = wasTwoTouches
      ? now - latestPointerDownTime
      : now - thisPointerDownTime;

    pointersRef.current.delete(e.pointerId);
    pointerDownTimesRef.current.delete(e.pointerId);
    pointerStartPosRef.current.delete(e.pointerId);
    twoFingerPosRef.current.delete(e.pointerId);
    trackpadRef.current?.releasePointerCapture(e.pointerId);

    // En sortie d'un scroll à 2 doigts, il ne reste qu'un doigt : lastPosRef
    // n'a jamais été mis à jour pendant le scroll (seul twoFingerPosRef l'était),
    // donc il pointe encore vers la position d'AVANT le scroll. Sans ce
    // recalage, le prochain mouvement 1 doigt calcule un delta énorme entre
    // cette vieille position et la position actuelle : le curseur téléporte.
    if (wasTwoTouches && pointersRef.current.size === 1) {
      const remainingId = Array.from(pointersRef.current.keys())[0];
      const remainingPos = twoFingerPosRef.current.get(remainingId);
      if (remainingPos) {
        lastPosRef.current = { x: remainingPos.x, y: remainingPos.y };
      }
    }

    if (dragHoldTimerRef.current !== null) {
      window.clearTimeout(dragHoldTimerRef.current);
      dragHoldTimerRef.current = null;
    }

    if (wasDragging && wasSingleTouch) {
      // Relâchement du drag démarré par le double-tap-and-hold.
      isDraggingRef.current = false;
      setIsDraggingUI(false);
      sendControl({ type: "mouseUp" });
      navigator.vibrate?.(10);
      gestureHandledRef.current = true;
      lastTapUpRef.current = null;
    } else if (!gestureHandledRef.current) {
      // Tap 2 doigts = right click
      if (wasTwoTouches && tapDuration < TAP_MAX_DURATION && !hasMovedRef.current) {
        sendControl({ type: "rightClick" });
        triggerClickFeedback();
        gestureHandledRef.current = true;
      }
      // Tap 1 doigt = left click
      else if (wasSingleTouch && tapDuration < TAP_MAX_DURATION && !hasMovedRef.current) {
        sendControl({ type: "leftClick" });
        triggerClickFeedback();
        gestureHandledRef.current = true;
        // Mémorisé pour détecter un éventuel double-tap-and-hold juste après.
        lastTapUpRef.current = {
          time: now,
          x: e.nativeEvent.clientX,
          y: e.nativeEvent.clientY,
        };
      }
    }

    if (pointersRef.current.size === 0) {
      gestureHandledRef.current = false;
    }
  };

  return {
    trackpadRef,
    isDragging: isDraggingUI,
    clickPulse,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
  };
}
