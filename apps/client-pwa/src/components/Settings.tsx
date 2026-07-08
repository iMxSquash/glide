import type { Dispatch, SetStateAction } from "react";

interface SettingsProps {
  sensitivity: number;
  setSensitivity: Dispatch<SetStateAction<number>>;
  invertScroll: boolean;
  setInvertScroll: Dispatch<SetStateAction<boolean>>;
  onDisconnect: () => void;
}

export function Settings({
  sensitivity,
  setSensitivity,
  invertScroll,
  setInvertScroll,
  onDisconnect,
}: SettingsProps) {
  return (
    <div className="px-6 pb-2 -mt-2">
      <div className="p-4 bg-surface rounded-2xl">
        <div className="flex items-center justify-between mb-2">
          <span className="text-secondary text-sm">Sensitivity</span>
          <span className="text-primary text-sm font-medium">{sensitivity.toFixed(1)}x</span>
        </div>
        <input
          type="range"
          min="0.5"
          max="4"
          step="0.1"
          value={sensitivity}
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSensitivity(Number(e.target.value))}
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
          onClick={onDisconnect}
          className="w-full mt-4 bg-background text-red-400 font-medium py-3 rounded-xl"
        >
          Disconnect
        </button>
      </div>
    </div>
  );
}
