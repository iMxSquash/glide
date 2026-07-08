import { useEffect, useState } from "react";
import { useGlideConnection } from "./useGlideConnection";
import { useWakeLock } from "./hooks/useWakeLock";
import { useVolumeControl } from "./hooks/useVolumeControl";
import { readLastConnection, saveLastConnection, clearLastConnection, parseSessionIdFromHash } from "./lib/session";
import { GlideLogo } from "./components/GlideLogo";
import { ConnectScreen } from "./components/ConnectScreen";
import { ConnectingSpinner } from "./components/ConnectingSpinner";
import { VirtualKeyboard } from "./components/VirtualKeyboard";
import { Settings } from "./components/Settings";
import { Trackpad } from "./components/Trackpad";
import { VolumeControl } from "./components/VolumeControl";

const SENSITIVITY_STORAGE_KEY = "glide-sensitivity";
const DEFAULT_SENSITIVITY = 2;
const INVERT_SCROLL_STORAGE_KEY = "glide-invert-scroll";
// Signaling déployé sur Render (voir vercel.json → build.env), défaut
// localhost gardé pour le dev (injecté au build par Vite).
const SIGNALING_URL = import.meta.env.VITE_SIGNALING_URL || "http://localhost:4000";

// Délai avant d'afficher l'indice "réveil du serveur" pendant une connexion :
// une connexion normale prend quelques centaines de ms, donc ce délai évite
// de flasher l'indice pour rien à chaque tentative.
const COLD_START_HINT_DELAY_MS = 4000;

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
  const [showSettings, setShowSettings] = useState(false);
  const [showKeyboard, setShowKeyboard] = useState(false);
  const [sensitivity, setSensitivity] = useState<number>(() => {
    const saved = localStorage.getItem(SENSITIVITY_STORAGE_KEY);
    return saved ? Number(saved) : DEFAULT_SENSITIVITY;
  });
  const [invertScroll, setInvertScroll] = useState<boolean>(() => {
    return localStorage.getItem(INVERT_SCROLL_STORAGE_KEY) === "true";
  });

  const { volume, muted, handleVolumeSliderChange } = useVolumeControl(connectionVolume, sendControl);
  useWakeLock(status === "connected");

  useEffect(() => {
    localStorage.setItem(SENSITIVITY_STORAGE_KEY, String(sensitivity));
  }, [sensitivity]);

  useEffect(() => {
    localStorage.setItem(INVERT_SCROLL_STORAGE_KEY, String(invertScroll));
  }, [invertScroll]);

  useEffect(() => {
    if (status !== "connecting") {
      setShowColdStartHint(false);
      return;
    }
    const timer = window.setTimeout(() => setShowColdStartHint(true), COLD_START_HINT_DELAY_MS);
    return () => window.clearTimeout(timer);
  }, [status]);

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
      saveLastConnection({ sessionId: activeSessionId, pin });
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

  const handleDisconnect = () => {
    disconnect();
    clearLastConnection();
    setActiveSessionId(null);
    setPendingSessionId(null);
    setShowManualEntry(false);
    setShowSettings(false);
    setPin("");
    setManualSessionId("");
  };

  if (showPinModal) {
    return (
      <ConnectScreen
        isScanning={isScanning}
        setIsScanning={setIsScanning}
        showManualEntry={showManualEntry}
        setShowManualEntry={setShowManualEntry}
        pendingSessionId={pendingSessionId}
        setPendingSessionId={setPendingSessionId}
        isConnecting={isConnecting}
        showColdStartHint={showColdStartHint}
        connectionError={connectionError}
        pin={pin}
        setPin={setPin}
        manualSessionId={manualSessionId}
        setManualSessionId={setManualSessionId}
        handleConnect={handleConnect}
        disconnect={disconnect}
      />
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
        <VirtualKeyboard onClose={() => setShowKeyboard(false)} sendControl={sendControl} />
      )}

      {isReconnecting && (
        <div className="mx-4 mb-2 px-4 py-2 bg-surface-light rounded-xl flex items-center gap-2">
          <ConnectingSpinner className="animate-spin h-4 w-4 text-accent" />
          <span className="text-sm text-secondary">Reconnexion...</span>
        </div>
      )}

      {showSettings && (
        <Settings
          sensitivity={sensitivity}
          setSensitivity={setSensitivity}
          invertScroll={invertScroll}
          setInvertScroll={setInvertScroll}
          onDisconnect={handleDisconnect}
        />
      )}

      <Trackpad
        sensitivity={sensitivity}
        invertScroll={invertScroll}
        sendInput={sendInput}
        sendControl={sendControl}
      />

      <VolumeControl
        volume={volume}
        muted={muted}
        onSliderChange={handleVolumeSliderChange}
        sendControl={sendControl}
      />
    </div>
  );
}
