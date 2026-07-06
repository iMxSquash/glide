import { useState, useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { BrowserQRCodeReader } from "@zxing/library";

interface PointerState {
  id: number;
  x: number;
  y: number;
}

// Distance cumulée (px) à partir de laquelle un tap est requalifié en mouvement.
const TAP_MOVE_THRESHOLD = 12;
// Durée max (ms) d'un tap pour qu'il soit considéré comme un clic.
const TAP_MAX_DURATION = 300;
const SENSITIVITY_STORAGE_KEY = "glide-sensitivity";
const DEFAULT_SENSITIVITY = 2;
// Le slider n'émet pas à chaque pixel glissé, pour ne pas flooder le socket.
const SET_VOLUME_DEBOUNCE_MS = 150;
const LAST_CONNECTION_KEY = "glide-last-connection";
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
  const [volume, setVolume] = useState(50);
  const [muted, setMuted] = useState(false);
  const [clickPulse, setClickPulse] = useState(false);
  const [showSettings, setShowSettings] = useState(false);
  const [isReconnecting, setIsReconnecting] = useState(false);
  const [sensitivity, setSensitivity] = useState<number>(() => {
    const saved = localStorage.getItem(SENSITIVITY_STORAGE_KEY);
    return saved ? Number(saved) : DEFAULT_SENSITIVITY;
  });
  const sensitivityRef = useRef(sensitivity);
  const socketRef = useRef<Socket | null>(null);
  const trackpadRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
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
  const volumeDebounceRef = useRef<number | null>(null);
  const wakeLockRef = useRef<WakeLockSentinel | null>(null);

  useEffect(() => {
    sensitivityRef.current = sensitivity;
    localStorage.setItem(SENSITIVITY_STORAGE_KEY, String(sensitivity));
  }, [sensitivity]);

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

  const connectWithPin = async (ip: string, pinCode: string) => {
    setIsConnecting(true);

    // Détecte si hébergé par le serveur Electron (même origine)
    const isHostedByServer =
      window.location.protocol === "https:" && window.location.port === "3000";
    const targetURL = isHostedByServer
      ? `${window.location.protocol}//${window.location.hostname}:${window.location.port}`
      : `https://${ip.replace(/:3000$/, "").trim()}:3000`;

    console.log(`Connexion à : ${targetURL} avec PIN ${pinCode}`);

    // rejectUnauthorized est une option Node : dans un navigateur, la confiance
    // au certificat auto-signé passe uniquement par l'acceptation manuelle
    // (Safari/Chrome) au premier accès HTTPS, pas par une option socket.io.
    const socket = io(targetURL, {
      auth: { pin: pinCode },
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
      const cleanIP = ip.replace(/:3000$/, "").trim();
      setServerIP(cleanIP);
      socketRef.current = socket;
      localStorage.setItem(
        LAST_CONNECTION_KEY,
        JSON.stringify({ ip: cleanIP, pin: pinCode }),
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

    socket.on("reconnect", () => {
      console.log("✅ Reconnecté !");
      setIsConnected(true);
      setIsReconnecting(false);
    });

    // Tous les essais de reconnexion ont échoué : retour à l'écran PIN.
    socket.on("reconnect_failed", () => {
      console.error("❌ Reconnexion impossible");
      setIsReconnecting(false);
      setIsConnected(false);
      socketRef.current = null;
      setShowPinModal(true);
    });

    // Le volume réel du PC est la seule source de vérité (le serveur l'envoie
    // à la connexion puis après chaque changement, cf. loudness côté serveur).
    socket.on("volumeState", (state: { volume: number; muted: boolean }) => {
      setVolume(state.volume);
      setMuted(state.muted);
    });

    socket.on("connect_error", (error) => {
      console.error("❌ Erreur connexion:", error);
      setIsConnecting(false);

      // Pendant une reconnexion en arrière-plan, connect_error se déclenche à
      // chaque tentative : ne pas spammer une popup, le bandeau suffit.
      if (hasConnectedOnce) return;

      const isStandaloneApp =
        window.matchMedia("(display-mode: standalone)").matches ||
        (navigator as unknown as { standalone?: boolean }).standalone === true;
      const standaloneHint = isStandaloneApp
        ? "\n\n⚠️ App installée détectée : iOS/Android ne proposent pas d'accepter un certificat depuis une app installée. Ouvre d'abord https://<IP>:3000 dans Safari/Chrome, accepte le certificat, puis reviens ici."
        : "";

      alert(
        `Connection failed: ${error.message}\n\nVérifier:\n1. Serveur lancé\n2. Windows Firewall autorise port 3000\n3. Téléphone et PC sur même WiFi${standaloneHint}`,
      );
    });
  };

  // Reconnexion directe au dernier serveur connu, sans re-saisir le PIN.
  useEffect(() => {
    const saved = localStorage.getItem(LAST_CONNECTION_KEY);
    if (!saved) return;
    try {
      const { ip, pin: savedPin } = JSON.parse(saved) as {
        ip?: string;
        pin?: string;
      };
      if (ip && savedPin) {
        setServerIP(ip);
        setPin(savedPin);
        connectWithPin(ip, savedPin);
      }
    } catch {
      // Donnée corrompue, ignorée : l'utilisateur retapera le PIN.
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const findServerAndConnect = async () => {
    if (pin.length !== 6) return;

    // Si IP manuelle fournie, l'utiliser directement
    if (serverIP) {
      connectWithPin(serverIP, pin);
      return;
    }

    // Sinon demander à l'utilisateur d'entrer l'IP
    setIsConnecting(false);
    alert("Please enter the server IP address shown on your PC.");
    setShowManualIP(true);
  };

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
                  const data = JSON.parse(result.getText());
                  stopQRScan();
                  connectWithPin(data.ip, data.pin);
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

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const rect = trackpadRef.current?.getBoundingClientRect();
    if (!rect) return;

    const now = Date.now();

    pointersRef.current.set(e.pointerId, {
      id: e.pointerId,
      x: e.nativeEvent.clientX - rect.left,
      y: e.nativeEvent.clientY - rect.top,
    });
    pointerDownTimesRef.current.set(e.pointerId, now);
    pointerStartPosRef.current.set(e.pointerId, {
      x: e.nativeEvent.clientX,
      y: e.nativeEvent.clientY,
    });

    trackpadRef.current?.setPointerCapture(e.pointerId);

    if (pointersRef.current.size === 1) {
      lastPosRef.current = {
        x: e.nativeEvent.clientX,
        y: e.nativeEvent.clientY,
      };
      gestureStartTimeRef.current = now;
      hasMovedRef.current = false;
      gestureHandledRef.current = false;
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
        hasMovedRef.current = true;
      }
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
    trackpadRef.current?.releasePointerCapture(e.pointerId);

    if (socketRef.current && !gestureHandledRef.current) {
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
      }
    }

    if (pointersRef.current.size === 0) {
      gestureHandledRef.current = false;
    }
  };

  if (showPinModal) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="bg-surface rounded-2xl p-8 w-full max-w-sm">
          <h1 className="text-3xl font-bold text-accent mb-2">Glide</h1>
          <p className="text-secondary mb-6">Enter PIN from your PC</p>

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
          ) : (
            <>
              <input
                type="text"
                placeholder="192.168.0.50 (IP only)"
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
                onClick={startQRScan}
                disabled={isConnecting}
                className="w-full bg-surface-light text-primary font-medium py-3 rounded-xl disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"
                  />
                </svg>
                Scan QR Code
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="flex items-center justify-between p-4">
        <h1 className="text-xl font-bold text-accent">Glide</h1>
        <div className="flex items-center gap-3">
          <div className="text-sm text-secondary">PIN: {pin}</div>
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
            />
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
          clickPulse ? "bg-surface-light" : ""
        }`}
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
