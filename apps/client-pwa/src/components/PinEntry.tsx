import { ConnectingSpinner } from "./ConnectingSpinner";

interface PinEntryProps {
  pin: string;
  onPinChange: (value: string) => void;
  onConnect: () => void;
  connectDisabled: boolean;
  isConnecting: boolean;
  showColdStartHint: boolean;
  onCancelConnecting: () => void;
  autoFocus?: boolean;
}

export function PinEntry({
  pin,
  onPinChange,
  onConnect,
  connectDisabled,
  isConnecting,
  showColdStartHint,
  onCancelConnecting,
  autoFocus,
}: PinEntryProps) {
  return (
    <>
      <input
        type="text"
        inputMode="numeric"
        maxLength={6}
        value={pin}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
          onPinChange(e.target.value.replace(/\D/g, ""))
        }
        className="w-full bg-background text-primary text-center text-3xl tracking-widest p-4 rounded-xl mb-4 focus:outline-none focus:ring-2 focus:ring-accent"
        placeholder="000000"
        disabled={isConnecting}
        autoFocus={autoFocus}
      />

      <button
        onClick={onConnect}
        disabled={connectDisabled}
        className="w-full bg-accent text-background font-medium py-3 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 mb-3"
      >
        {isConnecting ? (
          <>
            <ConnectingSpinner />
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
        <button onClick={onCancelConnecting} className="w-full text-secondary text-sm py-2 mb-3">
          Cancel
        </button>
      )}
    </>
  );
}
