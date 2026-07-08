import type { Dispatch, SetStateAction } from "react";
import { GlideLogo } from "./GlideLogo";
import { QrScanner } from "./QrScanner";
import { PinEntry } from "./PinEntry";
import { ConnectingSpinner } from "./ConnectingSpinner";

interface ConnectScreenProps {
  isScanning: boolean;
  setIsScanning: Dispatch<SetStateAction<boolean>>;
  showManualEntry: boolean;
  setShowManualEntry: Dispatch<SetStateAction<boolean>>;
  pendingSessionId: string | null;
  setPendingSessionId: Dispatch<SetStateAction<string | null>>;
  isConnecting: boolean;
  showColdStartHint: boolean;
  connectionError: string | null;
  pin: string;
  setPin: Dispatch<SetStateAction<string>>;
  manualSessionId: string;
  setManualSessionId: Dispatch<SetStateAction<string>>;
  handleConnect: (sessionId: string, pinCode: string) => void;
  disconnect: () => void;
}

export function ConnectScreen({
  isScanning,
  setIsScanning,
  showManualEntry,
  setShowManualEntry,
  pendingSessionId,
  setPendingSessionId,
  isConnecting,
  showColdStartHint,
  connectionError,
  pin,
  setPin,
  manualSessionId,
  setManualSessionId,
  handleConnect,
  disconnect,
}: ConnectScreenProps) {
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
          <QrScanner
            onScanned={(sessionId) => {
              setIsScanning(false);
              setPendingSessionId(sessionId);
            }}
            onCancel={() => setIsScanning(false)}
          />
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

            <PinEntry
              pin={pin}
              onPinChange={setPin}
              onConnect={() => handleConnect(manualSessionId.trim(), pin)}
              connectDisabled={pin.length !== 6 || !manualSessionId.trim() || isConnecting}
              isConnecting={isConnecting}
              showColdStartHint={showColdStartHint}
              onCancelConnecting={disconnect}
            />

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
            <PinEntry
              pin={pin}
              onPinChange={setPin}
              onConnect={() => handleConnect(pendingSessionId, pin)}
              connectDisabled={pin.length !== 6 || isConnecting}
              isConnecting={isConnecting}
              showColdStartHint={showColdStartHint}
              onCancelConnecting={disconnect}
              autoFocus
            />

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
            <ConnectingSpinner className="animate-spin h-8 w-8 text-accent mb-4" />
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
              onClick={() => setIsScanning(true)}
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
