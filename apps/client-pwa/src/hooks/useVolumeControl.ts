import { useEffect, useRef, useState } from "react";
import type { ControlChannelClientMessage, VolumeState } from "@glide/shared-types";

// Le slider n'émet pas à chaque pixel glissé, pour ne pas flooder le canal.
const SET_VOLUME_DEBOUNCE_MS = 150;

interface UseVolumeControl {
  volume: number;
  muted: boolean;
  handleVolumeSliderChange: (value: number) => void;
}

/**
 * Le volume réel du PC est la seule source de vérité (le serveur l'envoie à
 * l'auth puis après chaque changement, cf. loudness côté serveur) : le
 * slider met à jour l'affichage tout de suite, mais l'envoi au serveur est
 * debounced pour ne pas flooder le control channel pendant un drag.
 */
export function useVolumeControl(
  connectionVolume: VolumeState,
  sendControl: (message: ControlChannelClientMessage) => void,
): UseVolumeControl {
  const [volume, setVolume] = useState(50);
  const [muted, setMuted] = useState(false);
  const volumeDebounceRef = useRef<number | null>(null);

  useEffect(() => {
    setVolume(connectionVolume.volume);
    setMuted(connectionVolume.muted);
  }, [connectionVolume]);

  const handleVolumeSliderChange = (value: number) => {
    setVolume(value);
    if (volumeDebounceRef.current !== null) {
      window.clearTimeout(volumeDebounceRef.current);
    }
    volumeDebounceRef.current = window.setTimeout(() => {
      sendControl({ type: "setVolume", value });
    }, SET_VOLUME_DEBOUNCE_MS);
  };

  return { volume, muted, handleVolumeSliderChange };
}
