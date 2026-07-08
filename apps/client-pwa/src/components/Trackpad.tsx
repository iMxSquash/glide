import type { ControlChannelClientMessage, InputChannelMessage } from "@glide/shared-types";
import { useTrackpadGestures } from "../hooks/useTrackpadGestures";

interface TrackpadProps {
  sensitivity: number;
  invertScroll: boolean;
  sendInput: (message: InputChannelMessage) => void;
  sendControl: (message: ControlChannelClientMessage) => void;
}

export function Trackpad({ sensitivity, invertScroll, sendInput, sendControl }: TrackpadProps) {
  const {
    trackpadRef,
    isDragging,
    clickPulse,
    handlePointerDown,
    handlePointerMove,
    handlePointerUp,
  } = useTrackpadGestures({ sensitivity, invertScroll, sendInput, sendControl });

  return (
    <div
      ref={trackpadRef}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onPointerCancel={handlePointerUp}
      className={`flex-1 bg-surface m-4 rounded-2xl min-h-[200px] touch-none transition-[background-color] duration-150 ${
        clickPulse || isDragging ? "bg-surface-light" : ""
      } ${isDragging ? "ring-2 ring-accent" : ""}`}
    />
  );
}
