import { useEffect, useRef, useState } from "react";
import type { ControlChannelClientMessage, VolumeState } from "@glide/shared-types";
import { debounce } from "../lib/debounce";

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
  // sendControl a une identité stable (useCallback([]) dans useGlideConnection),
  // créer le debounce une seule fois est donc sûr.
  const debouncedSendVolumeRef = useRef<ReturnType<typeof debounce<[number]>> | null>(null);
  if (!debouncedSendVolumeRef.current) {
    debouncedSendVolumeRef.current = debounce(
      (value: number) => sendControl({ type: "setVolume", value }),
      SET_VOLUME_DEBOUNCE_MS,
    );
  }

  useEffect(() => {
    setVolume(connectionVolume.volume);
    setMuted(connectionVolume.muted);
  }, [connectionVolume]);

  useEffect(() => () => debouncedSendVolumeRef.current?.cancel(), []);

  const handleVolumeSliderChange = (value: number) => {
    setVolume(value);
    debouncedSendVolumeRef.current?.(value);
  };

  return { volume, muted, handleVolumeSliderChange };
}
