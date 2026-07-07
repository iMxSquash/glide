import { useState, useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { BrowserQRCodeReader } from "@zxing/library";
import type {
  AuthPayload,
  ClientToServerEvents,
  ServerToClientEvents,
} from "@glide/shared-types";

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
// Le slider n'émet pas à chaque pixel glissé, pour ne pas flooder le socket.
const SET_VOLUME_DEBOUNCE_MS = 150;
const LAST_CONNECTION_KEY = "glide-last-connection";
// Le serveur retombe sur ce port si 3000 est déjà pris (fallback +1, +2...) ;
// utilisé seulement quand l'IP saisie manuellement ne précise pas de port.
const DEFAULT_PORT = 3000;

// Accepte "192.168.1.5" ou "192.168.1.5:3001" (le serveur peut avoir basculé
// sur un autre port si 3000 était déjà occupé).
function parseIpAndPort(raw: string, fallbackPort = DEFAULT_PORT) {
  const trimmed = raw.trim();
  const match = trimmed.match(/^(.+):(\d+)$/);
  if (match) {
    return { ip: match[1], port: Number(match[2]) };
  }
  return { ip: trimmed, port: fallbackPort };
}
// Au-delà de cette vitesse (px/event), le multiplicateur d'accélération est saturé.
const ACCEL_SPEED_DIVISOR = 40;
const ACCEL_MAX_BONUS = 1.5;

// Sensibilité de base + boost d'accélération pour les mouvements rapides.
function applyAcceleration(dx: number, dy: number, sensitivity: number) {
  const magnitude = Math.hypot(dx, dy);
  const accelBonus = Math.min(magnitude / ACCEL_SPEED_DIVISOR, ACCEL_MAX_BONUS);
  const multiplier = sensitivity * (1 + accelBonus);
  return { x: dx * multiplier, y: dy * multiplier };
}

export default function App() {
  const [pin, setPin] = useState("");
  const [serverIP, setServerIP] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [showPinModal, setShowPinModal] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [showManualIP, setShowManualIP] = useState(false);
  const [connectionError, setConnectionError] = useState<string | null>(null);
  const [volume, setVolume] = useState(50);
  const [muted, setMuted] = useState(false);
  const [clickPulse, setClickPulse] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [showKeyboard, setShowKeyboard] = useState(false);
  const [keyboardText, setKeyboardText] = useState("");
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [sensitivity, setSensitivity] = useState<number>(() => {
    const saved = localStorage.getItem(SENSITIVITY_STORAGE_KEY);
    return saved ? Number(saved) : DEFAULT_SENSITIVITY;
  });
  const sensitivityRef = useRef(sensitivity);
  const [invertScroll, setInvertScroll] = useState<boolean>(() => {
    return localStorage.getItem(INVERT_SCROLL_STORAGE_KEY) === "true";
  });
  const invertScrollRef = useRef(invertScroll);
  const socketRef = useRef<Socket<ServerToClientEvents, ClientToServerEvents> | null>(
    null,
  );
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

  // Envoie les deltas accumulés au serveur à cadence fixe (~60 Hz max) au lieu
  // d'un event par pointermove, pour éviter de flooder le socket.
  useEffect(() => {
    let rafId: number;
    const flush = () => {
      const pending = pendingDeltaRef.current;
      if ((pending.x !== 0 || pending.y !== 0) && socketRef.current) {
        socketRef.current.emit("mouseDelta", { x: pending.x, y: pending.y });
        pendingDeltaRef.current = { x: 0, y: 0 };
      }
      const pendingScroll = pendingScrollRef.current;
      if ((pendingScroll.x !== 0 || pendingScroll.y !== 0) && socketRef.current) {
        socketRef.current.emit("scroll", { x: pendingScroll.x, y: pendingScroll.y });
        pendingScrollRef.current = { x: 0, y: 0 };
      }
      rafId = requestAnimationFrame(flush);
    };
    rafId = requestAnimationFrame(flush);
    return () => cancelAnimationFrame(rafId);
  }, []);

  // Sans Wake Lock, l'écran se verrouille au bout de 30s et coupe la socket.
  useEffect(() => {
    if (!isConnected) return;

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
  }, [isConnected]);

  const handleVolumeSliderChange = (value: number) => {
    setVolume(value);
    if (volumeDebounceRef.current !== null) {
      window.clearTimeout(volumeDebounceRef.current);
    }
    volumeDebounceRef.current = window.setTimeout(() => {
      socketRef.current?.emit("setVolume", value);
    }, SET_VOLUME_DEBOUNCE_MS);
  };

  const connectWithPin = async (
    ipInput: string,
    pinCode: string,
    explicitPort?: number,
  ) => {
    setIsConnecting(true);
    setConnectionError(null);

    const { ip, port } = parseIpAndPort(ipInput, explicitPort ?? DEFAULT_PORT);

    // Détecte si hébergé par le serveur Electron (même origine). Le port du
    // serveur peut varier (fallback si 3000 était occupé), donc on se fie au
    // protocole https (seul le serveur Electron packagé sert en HTTPS) plutôt
    // qu'à un port supposé fixe.
    const isHostedByServer = window.location.protocol === "https:";
    const targetURL = isHostedByServer
      ? `${window.location.protocol}//${window.location.hostname}:${window.location.port}`
      : `https://${ip}:${port}`;

    console.log(`Connexion à : ${targetURL} avec PIN ${pinCode}`);

    // rejectUnauthorized est une option Node : dans un navigateur, la confiance
    // au certificat auto-signé passe uniquement par l'acceptation manuelle
    // (Safari/Chrome) au premier accès HTTPS, pas par une option socket.io.
    const authPayload: AuthPayload = { pin: pinCode };
    const socket: Socket<ServerToClientEvents, ClientToServerEvents> = io(targetURL, {
      auth: authPayload,
      transports: ["websocket"],
      timeout: 10000,
      reconnectionAttempts: 3,
    });

    // true une fois qu'on a connecté au moins une fois, pour distinguer un échec
    // de la connexion initiale d'un échec de reconnexion automatique en arrière-plan.
    let hasConnectedOnce = false;

    socket.on("connect", () => {
      console.log("✅ Connexion réussie !");
      hasConnectedOnce = true;
      setIsConnected(true);
      setIsConnecting(false);
      setIsReconnecting(false);
      setShowPinModal(false);
      setServerIP(ip);
      socketRef.current = socket;
      localStorage.setItem(
        LAST_CONNECTION_KEY,
        JSON.stringify({ ip, pin: pinCode, port }),
      );
    });

    // Si le WiFi coupe ou l'écran se verrouille, l'UI restait "connectée" mais
    // plus rien ne marchait. On affiche un bandeau et on laisse socket.io
    // reconnecter automatiquement (reconnectionAttempts ci-dessus).
    socket.on("disconnect", (reason) => {
      console.warn("⚠️ Déconnecté:", reason);
      setIsConnected(false);
      setIsReconnecting(true);
    });

    // Pas de socket.on("reconnect", ...) : c'est un événement du Manager, pas
    // du Socket (piège classique de socket.io-client) — il ne se déclenche
    // jamais ici. Le socket ré-émet "connect" tout seul une fois reconnecté,
    // déjà géré par le handler "connect" ci-dessus.

    // Tous les essais de reconnexion ont échoué : retour à l'écran PIN.
    // "reconnect_failed" est lui aussi un événement du Manager (socket.io),
    // pas du Socket lui-même.
    socket.io.on("reconnect_failed", () => {
      console.error("❌ Reconnexion impossible");
      setIsReconnecting(false);
      setIsConnected(false);
      socketRef.current = null;
      setShowPinModal(true);
    });

    // Le volume réel du PC est la seule source de vérité (le serveur l'envoie
    // à la connexion puis après chaque changement, cf. loudness côté serveur).
    socket.on("volumeState", (state) => {
      setVolume(state.volume);
      setMuted(state.muted);
    });

    socket.on("connect_error", (error) => {
      console.error("❌ Erreur connexion:", error);
      setIsConnecting(false);

      // Pendant une reconnexion en arrière-plan, connect_error se déclenche à
      // chaque tentative : ne pas spammer une popup, le bandeau suffit.
      if (hasConnectedOnce) return;

      // Le serveur distingue "Invalid PIN" / rate-limit / pause d'un simple
      // échec réseau : afficher un message adapté plutôt qu'une alerte générique.
      if (error.message === "Invalid PIN") {
        setConnectionError(
          "PIN incorrect. Vérifie le code affiché sur ton PC et réessaie.",
        );
      } else if (error.message.includes("Too many attempts")) {
        setConnectionError(
          "Trop de tentatives avec un mauvais PIN. Réessaie dans quelques minutes.",
        );
      } else if (error.message === "Server paused") {
        setConnectionError(
          "Le serveur est en pause sur le PC. Reprends-le depuis le menu de la barre des tâches.",
        );
      } else {
        // Cause la plus fréquente d'un échec "réseau" générique : le certificat
        // auto-signé de cette IP n'a encore jamais été accepté par le navigateur
        // (nouvelle IP, cert régénéré...). Une websocket ne déclenche jamais le
        // prompt "faire confiance à ce certificat" — il faut visiter l'URL en
        // direct au moins une fois pour l'accepter.
        const isStandaloneApp =
          window.matchMedia("(display-mode: standalone)").matches ||
          (navigator as unknown as { standalone?: boolean }).standalone === true;
        const certHint = isStandaloneApp
          ? ` App installée détectée : ouvre d'abord https://${ip}:${port} dans Safari/Chrome, accepte le certificat, puis reviens ici.`
          : ` Si c'est la première connexion à cette IP, ouvre d'abord https://${ip}:${port} dans un onglet Safari/Chrome et accepte l'avertissement de certificat, puis reviens ici.`;
        setConnectionError(
          `Impossible de joindre le serveur (${error.message}). Vérifie que le serveur est lancé, que le firewall Windows autorise le port ${port}, et que le téléphone et le PC sont sur le même WiFi.${certHint}`,
        );
      }

      setShowManualIP(true);
    });
  };

  // Au premier chargement : soit on arrive via le lien du QR code (scanné par
  // l'appareil photo natif du téléphone, avant même d'avoir ouvert le site —
  // le PIN est en query string, l'IP/port sont déjà l'origine de cette page
  // puisque la PWA est servie par le même serveur), soit on tente une
  // reconnexion directe au dernier serveur connu, sans re-saisir le PIN.
  useEffect(() => {
    const pinFromUrl = new URLSearchParams(window.location.search).get("pin");
    if (pinFromUrl) {
      // Nettoie l'URL pour ne pas retenter la connexion à chaque refresh.
      window.history.replaceState({}, "", window.location.pathname);
      const ip = window.location.hostname;
      setServerIP(ip);
      setPin(pinFromUrl);
      connectWithPin(ip, pinFromUrl, Number(window.location.port) || undefined);
      return;
    }

    const saved = localStorage.getItem(LAST_CONNECTION_KEY);
    if (!saved) return;
    try {
      const { ip, pin: savedPin, port } = JSON.parse(saved) as {
        ip?: string;
        pin?: string;
        port?: number;
      };
      if (ip && savedPin) {
        setServerIP(ip);
        setPin(savedPin);
        connectWithPin(ip, savedPin, port);
      }
    } catch {
      // Donnée corrompue, ignorée : l'utilisateur retapera le PIN.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const findServerAndConnect = async () => {
    if (pin.length !== 6) return;

    if (!serverIP) {
      setConnectionError("Entre l'adresse IP du PC affichée sur l'écran du serveur.");
      return;
    }

    connectWithPin(serverIP, pin);
  };

  const startQRScan = () => {
    setConnectionError(null);
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
                  // Le QR encode un lien https://ip:port/?pin=xxxxxx (voir
                  // showPINWindow côté serveur), pas du JSON.
                  const url = new URL(result.getText());
                  const scannedPin = url.searchParams.get("pin");
                  if (!scannedPin) throw new Error("No PIN in QR code");
                  stopQRScan();
                  connectWithPin(
                    url.hostname,
                    scannedPin,
                    url.port ? Number(url.port) : undefined,
                  );
                } catch (e) {
                  console.error("Invalid QR code", e);
                }
              }
            },
          );
        } catch (err) {
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
      socketRef.current?.emit("typeText", value.slice(prev.length));
    } else if (value.length < prev.length && prev.startsWith(value)) {
      const removed = prev.length - value.length;
      for (let i = 0; i < removed; i++) {
        socketRef.current?.emit("keyPress", "Backspace");
      }
    } else {
      // Changement non-linéaire (autocorrection, sélection remplacée...) :
      // resynchroniser en effaçant tout puis retapant la nouvelle valeur.
      for (let i = 0; i < prev.length; i++) {
        socketRef.current?.emit("keyPress", "Backspace");
      }
      if (value) socketRef.current?.emit("typeText", value);
    }
    setKeyboardText(value);
  };

  const handleKeyboardKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      socketRef.current?.emit("keyPress", "Enter");
      setKeyboardText("");
    }
  };

  const closeKeyboard = () => {
    setShowKeyboard(false);
    setKeyboardText("");
  };

  // Il n'existait aucun moyen de revenir à l'écran PIN. On efface la dernière
  // connexion mémorisée pour ne pas se reconnecter automatiquement au relancement.
  const handleDisconnect = () => {
    socketRef.current?.disconnect();
    socketRef.current = null;
    localStorage.removeItem(LAST_CONNECTION_KEY);
    setIsConnected(false);
    setIsReconnecting(false);
    setShowSettings(false);
    setShowManualIP(false);
    setConnectionError(null);
    setShowPinModal(true);
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
            socketRef.current?.emit("mouseDown");
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
      socketRef.current?.emit("mouseUp");
      navigator.vibrate?.(10);
      gestureHandledRef.current = true;
      lastTapUpRef.current = null;
    } else if (socketRef.current && !gestureHandledRef.current) {
      // Tap 2 doigts = right click
      if (wasTwoTouches && tapDuration < TAP_MAX_DURATION && !hasMovedRef.current) {
        socketRef.current.emit("rightClick");
        triggerClickFeedback();
        gestureHandledRef.current = true;
      }
      // Tap 1 doigt = left click
      else if (wasSingleTouch && tapDuration < TAP_MAX_DURATION && !hasMovedRef.current) {
        socketRef.current.emit("leftClick");
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

    return (
      <div className="h-full bg-background flex items-center justify-center p-6">
        <div className="bg-surface rounded-2xl p-8 w-full max-w-sm">
          <h1 className="text-3xl font-bold text-accent mb-2">Glide</h1>
          <p className="text-secondary mb-6">
            {isScanning
              ? "Scan the QR code shown on your PC"
              : showManualIP
                ? "Enter the IP and PIN from your PC"
                : "Connect to your PC"}
          </p>

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
          ) : showManualIP ? (
            <>
              <input
                type="text"
                placeholder="192.168.0.50 (ou 192.168.0.50:3001)"
                value={serverIP}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setServerIP(e.target.value)
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
                onClick={findServerAndConnect}
                disabled={pin.length !== 6 || !serverIP || isConnecting}
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

              <button
                onClick={() => {
                  setConnectionError(null);
                  setShowManualIP(false);
                }}
                disabled={isConnecting}
                className="w-full bg-surface-light text-primary font-medium py-3 rounded-xl disabled:opacity-50 flex items-center justify-center gap-2"
              >
                {qrIcon}
                Scan QR Code Instead
              </button>
            </>
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
                onClick={() => {
                  setConnectionError(null);
                  setShowManualIP(true);
                }}
                className="w-full text-secondary text-sm py-2"
              >
                Enter IP and PIN manually
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
        <h1 className="text-xl font-bold text-accent">Glide</h1>
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
              onClick={() => socketRef.current?.emit("toggleMute")}
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
            onClick={() => socketRef.current?.emit("volumeDown")}
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
            onClick={() => socketRef.current?.emit("volumeUp")}
            className="w-12 h-12 bg-background rounded-xl text-primary font-bold"
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}
