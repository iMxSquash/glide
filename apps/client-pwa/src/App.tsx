import { useState, useEffect, useRef } from "react";
import { BrowserQRCodeReader } from "@zxing/library";
import { useGlideConnection } from "./useGlideConnection";

interface PointerState {
  id: number;
  x: number;
  y: number;
}

// Distance cumulée (px) à partir de laquelle un tap est requalifié en mouvement.
const TAP_MOVE_THRESHOLD = 12;
// Durée max (ms) d'un tap pour qu'il soit considéré comme un clic.
const TAP_MAX_DURATION = 300;
// Double-tap-and-hold (= drag) : délai max entre le relâchement du 1er tap et
// l'appui du 2e pour qu'ils soient considérés comme un double-tap.
const DOUBLE_TAP_MAX_INTERVAL = 300;
// Distance max (px) entre les deux taps du double-tap.
const DOUBLE_TAP_DISTANCE_THRESHOLD = 30;
// Durée (ms) que le 2e tap doit rester posé sans bouger avant que le drag démarre.
const DRAG_HOLD_DELAY = 150;
const SENSITIVITY_STORAGE_KEY = "glide-sensitivity";
const DEFAULT_SENSITIVITY = 2;
const INVERT_SCROLL_STORAGE_KEY = "glide-invert-scroll";
// Le slider n'émet pas à chaque pixel glissé, pour ne pas flooder le canal.
const SET_VOLUME_DEBOUNCE_MS = 150;
const LAST_CONNECTION_KEY = "glide-last-connection";
// Signaling déployé sur Render (voir vercel.json → build.env), défaut
// localhost gardé pour le dev (injecté au build par Vite).
const SIGNALING_URL = import.meta.env.VITE_SIGNALING_URL || "http://localhost:4000";

// Au-delà de cette vitesse (px/event), le multiplicateur d'accélération est saturé.
const ACCEL_SPEED_DIVISOR = 40;
const ACCEL_MAX_BONUS = 1.5;

// Délai avant d'afficher l'indice "réveil du serveur" pendant une connexion :
// une connexion normale prend quelques centaines de ms, donc ce délai évite
// de flasher l'indice pour rien à chaque tentative.
const COLD_START_HINT_DELAY_MS = 4000;

// Sensibilité de base + boost d'accélération pour les mouvements rapides.
function applyAcceleration(dx: number, dy: number, sensitivity: number) {
  const magnitude = Math.hypot(dx, dy);
  const accelBonus = Math.min(magnitude / ACCEL_SPEED_DIVISOR, ACCEL_MAX_BONUS);
  const multiplier = sensitivity * (1 + accelBonus);
  return { x: dx * multiplier, y: dy * multiplier };
}

interface LastConnection {
  sessionId: string;
  pin: string;
}

function readLastConnection(): LastConnection | null {
  const saved = localStorage.getItem(LAST_CONNECTION_KEY);
  if (!saved) return null;
  try {
    const parsed = JSON.parse(saved) as Partial<LastConnection>;
    if (parsed.sessionId && parsed.pin) {
      return { sessionId: parsed.sessionId, pin: parsed.pin };
    }
  } catch {
    // Donnée corrompue, ignorée : l'utilisateur retapera le PIN.
  }
  return null;
}

// Le lien/QR encode `#s=<sessionId>` (voir showPINWindow côté serveur) : le
// PIN ne transite jamais par l'URL, seule la session est connue à l'avance.
function parseSessionIdFromHash(hash: string): string | null {
  const match = hash.match(/^#s=(.+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function GlideLogo({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 633 502"
      fill="currentColor"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path
        fillRule="evenodd"
        clipRule="evenodd"
        d="M469.635 1.62489C454.32 5.09228 443.333 11.3734 429.348 24.6589C410.259 42.7918 397.347 63.2079 365.499 125.624C330.074 195.056 322.544 210.409 308.448 215.721C305.682 216.764 299.687 217.557 294.105 212.656C286.882 206.315 281.345 196.034 269.358 166.692C264.755 155.428 258.488 141.512 255.43 135.767C237.26 101.627 206.97 89.3228 177.185 103.981C157.09 113.871 146.073 129.421 127.258 174.462C112.037 210.897 101.28 225.244 81.9111 234.949C69.6871 241.076 58.3126 243.273 35.6758 243.888C17.2864 244.386 15.2971 244.789 9.55197 249.172C-4.8447 260.153 -2.59716 282.02 13.7977 290.499C20.5152 293.973 51.6379 294.018 69.2242 290.579C98.6639 284.823 117.219 275.084 135.338 255.878C150.039 240.294 158.334 226.246 173.203 191.754C188.711 155.784 194.365 147.102 202.294 147.102C210.792 147.102 213.946 160.516 224.003 184.666C245.072 235.259 252.452 248.919 272.496 259.722C284.778 266.341 296.648 266.28 301.514 266.28C307.281 266.28 318.528 264.991 329.237 259.722C343.11 252.895 357.672 238.251 371.57 217.15C376.625 209.477 392.32 180.36 406.449 152.445C420.58 124.529 437.057 94.2791 443.066 85.2197C460.991 58.1948 476.559 46.4818 490.053 49.8691C501.425 52.7239 499.99 62.8909 480.976 114.156C473.711 133.745 457.121 179.006 444.111 214.735L420.456 279.694L393.844 289.681C289.394 328.882 228.806 367.134 210.669 405.33C205.613 415.982 203.853 423.646 203.486 435.614C203.256 443.09 205.645 455.19 209.921 463.209C222.822 487.406 250.413 501.498 284.891 501.498C336.396 501.498 380.381 473.186 412.985 419.043C425.195 398.77 432.897 382.339 445.714 349.233C458.563 316.04 453.521 319.933 496.557 309.987C533.271 301.503 560.882 296.953 590.596 294.493C619.553 292.096 624.846 289.963 630.513 278.403C636.958 265.262 629.275 249.282 614.562 245.218C599.777 241.136 519.738 252.135 484.929 263.032C482.076 263.926 479.401 264.315 478.983 263.896C478.276 263.189 497.584 209.527 525.813 133.745C543.326 86.7317 546.304 70.3427 546.304 58.7524C546.304 47.162 544.824 40.1935 540.584 32.1635C527.918 8.16783 497.866 -4.76671 469.635 1.62489ZM395.415 344.335C394.813 346.048 390.113 356.411 384.968 367.362C373.628 391.502 356.78 416.566 344.12 428.138C325.689 444.982 298.178 455.309 279.151 452.522C268.019 450.893 256.65 445.623 254.137 440.929C245.884 425.508 275.622 397.372 327.994 371.05C347.965 361.011 392.343 341.347 395.228 341.258C395.931 341.236 396.015 342.622 395.415 344.335Z"
      />
    </svg>
  );
}

export default function App() {
  const { status, errorMessage, volume: connectionVolume, connect, disconnect, sendControl, sendInput } =
    useGlideConnection({ signalingUrl: SIGNALING_URL });

  // Dérivé du statut de connexion WebRTC plutôt que dupliqué en state local :
  // "reconnecting" n'est atteignable qu'après un premier succès (voir
  // useGlideConnection), donc le trackpad reste affiché pendant une reco.
  const showPinModal = status !== "connected" && status !== "reconnecting";
  const isConnecting = status === "connecting";
  const isReconnecting = status === "reconnecting";
  const connectionError = status === "error" ? errorMessage : null;

  const [pin, setPin] = useState("");
  const [manualSessionId, setManualSessionId] = useState("");
  // Session connue (via lien QR ou scan) mais PIN pas encore saisi.
  const [pendingSessionId, setPendingSessionId] = useState<string | null>(null);
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  // Affiché après COLD_START_HINT_DELAY_MS passés en "connecting" : le
  // signaling (Render free tier) peut mettre jusqu'à ~1 min à se réveiller,
  // sans ça l'utilisateur ne voit qu'un spinner muet pendant ce temps.
  const [showColdStartHint, setShowColdStartHint] = useState(false);
  const [isScanning, setIsScanning] = useState(false);
  const [showManualEntry, setShowManualEntry] = useState(false);
  const [volume, setVolume] = useState(50);
  const [muted, setMuted] = useState(false);
  const [clickPulse, setClickPulse] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showKeyboard, setShowKeyboard] = useState(false);
  const [keyboardText, setKeyboardText] = useState("");
  const [sensitivity, setSensitivity] = useState<number>(() => {
    const saved = localStorage.getItem(SENSITIVITY_STORAGE_KEY);
    return saved ? Number(saved) : DEFAULT_SENSITIVITY;
  });
  const sensitivityRef = useRef(sensitivity);
  const [invertScroll, setInvertScroll] = useState<boolean>(() => {
    return localStorage.getItem(INVERT_SCROLL_STORAGE_KEY) === "true";
  });
  const invertScrollRef = useRef(invertScroll);
  const trackpadRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const keyboardInputRef = useRef<HTMLInputElement>(null);
  const codeReaderRef = useRef<BrowserQRCodeReader | null>(null);
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
  const volumeDebounceRef = useRef<number | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    sensitivityRef.current = sensitivity;
    localStorage.setItem(SENSITIVITY_STORAGE_KEY, String(sensitivity));
  }, [sensitivity]);

  useEffect(() => {
    invertScrollRef.current = invertScroll;
    localStorage.setItem(INVERT_SCROLL_STORAGE_KEY, String(invertScroll));
  }, [invertScroll]);

  // Le volume réel du PC est la seule source de vérité (le serveur l'envoie
  // à l'auth puis après chaque changement, cf. loudness côté serveur).
  useEffect(() => {
    setVolume(connectionVolume.volume);
    setMuted(connectionVolume.muted);
  }, [connectionVolume]);

  useEffect(() => {
    if (status !== "connecting") {
      setShowColdStartHint(false);
      return;
    }
    const timer = window.setTimeout(() => setShowColdStartHint(true), COLD_START_HINT_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [status]);

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

  // Sans Wake Lock, l'écran se verrouille au bout de 30s et coupe la connexion.
  useEffect(() => {
    if (status !== "connected") return;

    const requestWakeLock = async () => {
      try {
        if ("wakeLock" in navigator) {
          wakeLockRef.current = await navigator.wakeLock.request("screen");
        }
      } catch (err) {
        console.warn("Wake Lock request failed:", err);
      }
    };

    requestWakeLock();

    // Le wake lock est relâché par le système quand l'onglet passe en arrière-plan
    // (écran éteint manuellement, changement d'app) : il faut le redemander au retour.
    const handleVisibilityChange = () => {
      if (document.visibilityState === "visible") {
        requestWakeLock();
      }
    };
    document.addEventListener("visibilitychange", handleVisibilityChange);

    return () => {
      document.removeEventListener("visibilitychange", handleVisibilityChange);
      wakeLockRef.current?.release().catch(() => {});
      wakeLockRef.current = null;
    };
  }, [status]);

  const handleVolumeSliderChange = (value: number) => {
    setVolume(value);
    if (volumeDebounceRef.current !== null) {
      window.clearTimeout(volumeDebounceRef.current);
    }
    volumeDebounceRef.current = window.setTimeout(() => {
      sendControl({ type: "setVolume", value });
    }, SET_VOLUME_DEBOUNCE_MS);
  };

  const handleConnect = (sessionId: string, pinCode: string) => {
    setActiveSessionId(sessionId);
    setPin(pinCode);
    setPendingSessionId(null);
    setShowManualEntry(false);
    connect(sessionId, pinCode);
  };

  // Mémorise la connexion une fois l'auth confirmée, pour la reconnexion
  // automatique au prochain lancement (sans re-scanner le QR).
  useEffect(() => {
    if (status === "connected" && activeSessionId && pin) {
      localStorage.setItem(
        LAST_CONNECTION_KEY,
        JSON.stringify({ sessionId: activeSessionId, pin } satisfies LastConnection),
      );
    }
  }, [status, activeSessionId, pin]);

  // Au premier chargement : soit on arrive via le lien du QR code (scanné par
  // l'appareil photo natif du téléphone, la session est dans le hash), soit
  // on tente une reconnexion directe à la dernière session connue, sans
  // re-scanner ni re-saisir le PIN.
  useEffect(() => {
    const hashSessionId = parseSessionIdFromHash(window.location.hash);
    if (hashSessionId) {
      // Nettoie l'URL pour ne pas retenter ce lien à chaque refresh (la
      // session côté PC change à chaque relancement de Glide).
      window.history.replaceState({}, "", window.location.pathname + window.location.search);
      const saved = readLastConnection();
      if (saved && saved.sessionId === hashSessionId) {
        handleConnect(hashSessionId, saved.pin);
      } else {
        setPendingSessionId(hashSessionId);
      }
      return;
    }

    const saved = readLastConnection();
    if (saved) {
      handleConnect(saved.sessionId, saved.pin);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const startQRScan = () => {
    setIsScanning(true);
  };

  const stopQRScan = () => {
    if (codeReaderRef.current) {
      codeReaderRef.current.reset();
      codeReaderRef.current = null;
    }
    setIsScanning(false);
  };

  useEffect(() => {
    if (isScanning && videoRef.current) {
      const scan = async () => {
        try {
          codeReaderRef.current = new BrowserQRCodeReader();
          await codeReaderRef.current.decodeFromVideoDevice(
            null,
            videoRef.current!,
            (result) => {
              if (result) {
                try {
                  // Le QR encode un lien https://pwa-url/#s=<sessionId> (voir
                  // showPINWindow côté serveur), le PIN n'y est pas : il reste
                  // à saisir une fois la session connue.
                  const url = new URL(result.getText());
                  const scannedSessionId = parseSessionIdFromHash(url.hash);
                  if (!scannedSessionId) throw new Error("No session in QR code");
                  stopQRScan();
                  setPendingSessionId(scannedSessionId);
                } catch (e) {
                  console.error("Invalid QR code", e);
                }
              }
            },
          );
        } catch {
          alert("Camera access denied");
          setIsScanning(false);
        }
      };
      scan();
    }
  }, [isScanning]);

  const triggerClickFeedback = () => {
    navigator.vibrate?.(10);
    setClickPulse(true);
    window.setTimeout(() => setClickPulse(false), 150);
  };

  // Focus l'input dès l'ouverture du panneau clavier, pour ouvrir le clavier
  // virtuel du téléphone immédiatement.
  useEffect(() => {
    if (showKeyboard) {
      keyboardInputRef.current?.focus();
    }
  }, [showKeyboard]);

  // Diffe l'ancienne et la nouvelle valeur de l'input pour envoyer seulement
  // les caractères ajoutés/supprimés au serveur (keyboard.type côté PC), au
  // lieu de renvoyer tout le texte à chaque frappe.
  const handleKeyboardInputChange = (value: string) => {
    const prev = keyboardText;
    if (value.length > prev.length && value.startsWith(prev)) {
      sendControl({ type: "typeText", text: value.slice(prev.length) });
    } else if (value.length < prev.length && prev.startsWith(value)) {
      const removed = prev.length - value.length;
      for (let i = 0; i < removed; i++) {
        sendControl({ type: "keyPress", key: "Backspace" });
      }
    } else {
      // Changement non-linéaire (autocorrection, sélection remplacée...) :
      // resynchroniser en effaçant tout puis retapant la nouvelle valeur.
      for (let i = 0; i < prev.length; i++) {
        sendControl({ type: "keyPress", key: "Backspace" });
      }
      if (value) sendControl({ type: "typeText", text: value });
    }
    setKeyboardText(value);
  };

  const handleKeyboardKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      sendControl({ type: "keyPress", key: "Enter" });
      setKeyboardText("");
    }
  };

  const closeKeyboard = () => {
    setShowKeyboard(false);
    setKeyboardText("");
  };

  const handleDisconnect = () => {
    disconnect();
    localStorage.removeItem(LAST_CONNECTION_KEY);
    setActiveSessionId(null);
    setPendingSessionId(null);
    setShowManualEntry(false);
    setShowSettings(false);
    setPin("");
    setManualSessionId("");
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

  if (showPinModal) {
    const qrIcon = (
      <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"
        />
      </svg>
    );

    const subtitle = isScanning
      ? "Scan the QR code shown on your PC"
      : showManualEntry
        ? "Enter the session code and PIN from your PC"
        : pendingSessionId
          ? "Enter the PIN shown on your PC"
          : isConnecting
            ? "Reconnecting to your last PC…"
            : "Connect to your PC";

    return (
      <div className="h-full bg-background flex items-center justify-center p-6">
        <div className="bg-surface rounded-2xl p-8 w-full max-w-sm">
          <div className="flex items-center gap-2 mb-2">
            <GlideLogo className="w-8 h-8 text-accent" />
            <h1 className="text-3xl font-bold text-accent">Glide</h1>
          </div>
          <p className="text-secondary mb-6">{subtitle}</p>

          {connectionError && (
            <div className="bg-background text-red-400 text-sm p-3 rounded-xl mb-4 border border-red-400/30">
              {connectionError}
            </div>
          )}

          {isScanning ? (
            <>
              <video
                ref={videoRef}
                className="w-full h-64 bg-background rounded-xl mb-4"
                autoPlay
                playsInline
              />
              <button
                onClick={stopQRScan}
                className="w-full bg-secondary text-background font-medium py-3 rounded-xl mb-3"
              >
                Cancel
              </button>
            </>
          ) : showManualEntry ? (
            <>
              <input
                type="text"
                placeholder="Session code"
                value={manualSessionId}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setManualSessionId(e.target.value)
                }
                className="w-full bg-background text-primary text-center p-3 rounded-xl mb-3 focus:outline-none focus:ring-2 focus:ring-accent text-sm"
                disabled={isConnecting}
              />

              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={pin}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setPin(e.target.value.replace(/\D/g, ""))
                }
                className="w-full bg-background text-primary text-center text-3xl tracking-widest p-4 rounded-xl mb-4 focus:outline-none focus:ring-2 focus:ring-accent"
                placeholder="000000"
                disabled={isConnecting}
              />

              <button
                onClick={() => handleConnect(manualSessionId.trim(), pin)}
                disabled={pin.length !== 6 || !manualSessionId.trim() || isConnecting}
                className="w-full bg-accent text-background font-medium py-3 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 mb-3"
              >
                {isConnecting ? (
                  <>
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                        fill="none"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    Connecting...
                  </>
                ) : (
                  "Connect"
                )}
              </button>

              {isConnecting && showColdStartHint && (
                <p className="text-secondary text-xs text-center mb-3">
                  Waking up the server, this can take up to a minute the first time…
                </p>
              )}

              {isConnecting && (
                <button
                  onClick={disconnect}
                  className="w-full text-secondary text-sm py-2 mb-3"
                >
                  Cancel
                </button>
              )}

              <button
                onClick={() => setShowManualEntry(false)}
                disabled={isConnecting}
                className="w-full bg-surface-light text-primary font-medium py-3 rounded-xl disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {qrIcon}
                Scan QR Code Instead
              </button>
            </>
          ) : pendingSessionId ? (
            <>
              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={pin}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setPin(e.target.value.replace(/\D/g, ""))
                }
                className="w-full bg-background text-primary text-center text-3xl tracking-widest p-4 rounded-xl mb-4 focus:outline-none focus:ring-2 focus:ring-accent"
                placeholder="000000"
                disabled={isConnecting}
                autoFocus
              />

              <button
                onClick={() => handleConnect(pendingSessionId, pin)}
                disabled={pin.length !== 6 || isConnecting}
                className="w-full bg-accent text-background font-medium py-3 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 mb-3"
              >
                {isConnecting ? (
                  <>
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                        fill="none"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    Connecting...
                  </>
                ) : (
                  "Connect"
                )}
              </button>

              {isConnecting && showColdStartHint && (
                <p className="text-secondary text-xs text-center mb-3">
                  Waking up the server, this can take up to a minute the first time…
                </p>
              )}

              {isConnecting && (
                <button
                  onClick={disconnect}
                  className="w-full text-secondary text-sm py-2 mb-3"
                >
                  Cancel
                </button>
              )}

              <button
                onClick={() => setPendingSessionId(null)}
                disabled={isConnecting}
                className="w-full text-secondary text-sm py-2 disabled:opacity-50"
              >
                Not your PC? Scan again
              </button>
            </>
          ) : isConnecting ? (
            // Reconnexion auto silencieuse (session/PIN mémorisés au dernier
            // lancement) : sans cet écran, l'utilisateur ne voyait rien
            // pendant la tentative (le menu par défaut s'affichait comme si
            // de rien n'était), potentiellement jusqu'à ~1 min si le
            // signaling se réveille (Render free tier).
            <div className="flex flex-col items-center py-6">
              <svg className="animate-spin h-8 w-8 text-accent mb-4" viewBox="0 0 24 24">
                <circle
                  className="opacity-25"
                  cx="12"
                  cy="12"
                  r="10"
                  stroke="currentColor"
                  strokeWidth="4"
                  fill="none"
                />
                <path
                  className="opacity-75"
                  fill="currentColor"
                  d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                />
              </svg>
              <p className="text-secondary text-sm mb-4">Connecting to your PC…</p>
              {showColdStartHint && (
                <p className="text-secondary text-xs text-center mb-4">
                  Waking up the server, this can take up to a minute the first time…
                </p>
              )}
              <button onClick={disconnect} className="text-secondary text-sm py-2">
                Cancel
              </button>
            </div>
          ) : (
            <>
              <button
                onClick={startQRScan}
                className="w-full bg-accent text-background font-medium py-4 rounded-xl flex items-center justify-center gap-2 mb-3"
              >
                {qrIcon}
                Scan QR Code
              </button>

              <button
                onClick={() => setShowManualEntry(true)}
                className="w-full text-secondary text-sm py-2"
              >
                Enter session code manually
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="h-full bg-background flex flex-col">
      <div className="flex items-center justify-between p-4">
        <div className="flex items-center gap-2">
          <GlideLogo className="w-6 h-6 text-accent" />
          <h1 className="text-xl font-bold text-accent">Glide</h1>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => setShowKeyboard(true)}
            aria-label="Keyboard"
            className="w-9 h-9 flex items-center justify-center bg-surface rounded-lg text-secondary"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M3 6a2 2 0 012-2h14a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V6zM6 9h.01M9 9h.01M12 9h.01M15 9h.01M18 9h.01M6 12h.01M9 12h.01M12 12h.01M15 12h.01M18 12h.01M8 15h8"
              />
            </svg>
          </button>
          <button
            onClick={() => setShowSettings((v) => !v)}
            aria-label="Settings"
            className="w-9 h-9 flex items-center justify-center bg-surface rounded-lg text-secondary"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.065 2.572c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.572 1.065c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.065-2.572c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
              />
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
              />
            </svg>
          </button>
        </div>
      </div>

      {showKeyboard && (
        <div
          className="fixed inset-0 bg-background/95 z-50 flex flex-col p-6"
          style={{ paddingTop: "calc(env(safe-area-inset-top) + 1.5rem)" }}
        >
          <div className="flex items-center justify-between mb-4">
            <h2 className="text-lg font-semibold text-primary">Keyboard</h2>
            <button
              onClick={closeKeyboard}
              className="text-secondary bg-surface px-4 py-2 rounded-xl text-sm"
            >
              Close
            </button>
          </div>
          <input
            ref={keyboardInputRef}
            type="text"
            value={keyboardText}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              handleKeyboardInputChange(e.target.value)
            }
            onKeyDown={handleKeyboardKeyDown}
            enterKeyHint="send"
            autoCapitalize="off"
            autoCorrect="off"
            spellCheck={false}
            placeholder="Type here..."
            className="w-full bg-surface text-primary p-4 rounded-xl text-lg focus:outline-none focus:ring-2 focus:ring-accent"
          />
          <p className="text-secondary text-sm mt-3">
            Les frappes sont envoyées en direct au PC. Entrée envoie la touche Entrée.
          </p>
        </div>
      )}

      {isReconnecting && (
        <div className="mx-4 mb-2 px-4 py-2 bg-surface-light rounded-xl flex items-center gap-2">
          <svg className="animate-spin h-4 w-4 text-accent" viewBox="0 0 24 24">
            <circle
              className="opacity-25"
              cx="12"
              cy="12"
              r="10"
              stroke="currentColor"
              strokeWidth="4"
              fill="none"
            />
            <path
              className="opacity-75"
              fill="currentColor"
              d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
            />
          </svg>
          <span className="text-sm text-secondary">Reconnexion...</span>
        </div>
      )}

      {showSettings && (
        <div className="px-6 pb-2 -mt-2">
          <div className="p-4 bg-surface rounded-2xl">
            <div className="flex items-center justify-between mb-2">
              <span className="text-secondary text-sm">Sensitivity</span>
              <span className="text-primary text-sm font-medium">
                {sensitivity.toFixed(1)}x
              </span>
            </div>
            <input
              type="range"
              min="0.5"
              max="4"
              step="0.1"
              value={sensitivity}
              onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                setSensitivity(Number(e.target.value))
              }
              className="w-full"
              style={{ "--range-progress": `${((sensitivity - 0.5) / 3.5) * 100}%` } as React.CSSProperties}
            />
            <div className="flex items-center justify-between mt-4">
              <span className="text-secondary text-sm">Invert scroll direction</span>
              <button
                onClick={() => setInvertScroll((v) => !v)}
                role="switch"
                aria-checked={invertScroll}
                aria-label="Invert scroll direction"
                className={`w-12 h-7 rounded-full flex items-center px-1 transition-colors ${
                  invertScroll ? "bg-accent justify-end" : "bg-background justify-start"
                }`}
              >
                <span className="w-5 h-5 rounded-full bg-primary" />
              </button>
            </div>
            <button
              onClick={handleDisconnect}
              className="w-full mt-4 bg-background text-red-400 font-medium py-3 rounded-xl"
            >
              Disconnect
            </button>
          </div>
        </div>
      )}

      <div
        ref={trackpadRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className={`flex-1 bg-surface m-4 rounded-2xl min-h-[200px] touch-none transition-[background-color] duration-150 ${
          clickPulse || isDraggingUI ? "bg-surface-light" : ""
        } ${isDraggingUI ? "ring-2 ring-accent" : ""}`}
      />

      <div className="p-6 bg-surface m-4 rounded-2xl">
        <div className="flex items-center justify-between mb-3">
          <span className="text-secondary">Volume</span>
          <div className="flex items-center gap-3">
            <span className="text-primary font-medium">
              {muted ? "Muted" : `${volume}%`}
            </span>
            <button
              onClick={() => sendControl({ type: "toggleMute" })}
              aria-label={muted ? "Unmute" : "Mute"}
              className={`w-9 h-9 flex items-center justify-center rounded-lg ${
                muted ? "bg-accent text-background" : "bg-background text-secondary"
              }`}
            >
              {muted ? (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M17 14L23 20M23 14L17 20M11 5L6 9H2v6h4l5 4V5z"
                  />
                </svg>
              ) : (
                <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M11 5L6 9H2v6h4l5 4V5zM15.5 8.5a5 5 0 010 7"
                  />
                </svg>
              )}
            </button>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => sendControl({ type: "volumeDown" })}
            className="w-12 h-12 bg-background rounded-xl text-primary font-bold"
          >
            −
          </button>
          <input
            type="range"
            min="0"
            max="100"
            value={volume}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              handleVolumeSliderChange(Number(e.target.value))
            }
            className="flex-1"
            style={{ "--range-progress": `${volume}%` } as React.CSSProperties}
          />
          <button
            onClick={() => sendControl({ type: "volumeUp" })}
            className="w-12 h-12 bg-background rounded-xl text-primary font-bold"
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}
