import { useEffect, useRef, useState } from "react";
import type { ControlChannelClientMessage } from "@glide/shared-types";

interface VirtualKeyboardProps {
  onClose: () => void;
  sendControl: (message: ControlChannelClientMessage) => void;
}

export function VirtualKeyboard({ onClose, sendControl }: VirtualKeyboardProps) {
  const [keyboardText, setKeyboardText] = useState("");
  const keyboardInputRef = useRef<HTMLInputElement>(null);

  // Focus l'input dès l'ouverture du panneau clavier, pour ouvrir le clavier
  // virtuel du téléphone immédiatement.
  useEffect(() => {
    keyboardInputRef.current?.focus();
  }, []);

  // Diffe l'ancienne et la nouvelle valeur de l'input pour envoyer seulement
  // les caractères ajoutés/supprimés au serveur (keyboard.type côté PC), au
  // lieu de renvoyer tout le texte à chaque frappe.
  const handleInputChange = (value: string) => {
    const prev = keyboardText;
    if (value.length > prev.length && value.startsWith(prev)) {
      sendControl({ type: "typeText", text: value.slice(prev.length) });
    } else if (value.length < prev.length && prev.startsWith(value)) {
      const removed = prev.length - value.length;
      for (let i = 0; i < removed; i++) {
        sendControl({ type: "keyPress", key: "Backspace" });
      }
    } else {
      // Changement non-linéaire (autocorrection, sélection remplacée...) :
      // resynchroniser en effaçant tout puis retapant la nouvelle valeur.
      for (let i = 0; i < prev.length; i++) {
        sendControl({ type: "keyPress", key: "Backspace" });
      }
      if (value) sendControl({ type: "typeText", text: value });
    }
    setKeyboardText(value);
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === "Enter") {
      e.preventDefault();
      sendControl({ type: "keyPress", key: "Enter" });
      setKeyboardText("");
    }
  };

  const handleClose = () => {
    setKeyboardText("");
    onClose();
  };

  return (
    <div
      className="fixed inset-0 bg-background/95 z-50 flex flex-col p-6"
      style={{ paddingTop: "calc(env(safe-area-inset-top) + 1.5rem)" }}
    >
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-primary">Keyboard</h2>
        <button
          onClick={handleClose}
          className="text-secondary bg-surface px-4 py-2 rounded-xl text-sm"
        >
          Close
        </button>
      </div>
      <input
        ref={keyboardInputRef}
        type="text"
        value={keyboardText}
        onChange={(e: React.ChangeEvent<HTMLInputElement>) => handleInputChange(e.target.value)}
        onKeyDown={handleKeyDown}
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
  );
}
