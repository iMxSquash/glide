import type { ControlChannelClientMessage } from "@glide/shared-types";

interface VolumeControlProps {
  volume: number;
  muted: boolean;
  onSliderChange: (value: number) => void;
  sendControl: (message: ControlChannelClientMessage) => void;
}

export function VolumeControl({ volume, muted, onSliderChange, sendControl }: VolumeControlProps) {
  return (
    <div className="p-6 bg-surface m-4 rounded-2xl">
      <div className="flex items-center justify-between mb-3">
        <span className="text-secondary">Volume</span>
        <div className="flex items-center gap-3">
          <span className="text-primary font-medium">{muted ? "Muted" : `${volume}%`}</span>
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
          onChange={(e: React.ChangeEvent<HTMLInputElement>) => onSliderChange(Number(e.target.value))}
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
  );
}
