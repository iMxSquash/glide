export interface LastConnection {
  sessionId: string;
  pin: string;
}

const LAST_CONNECTION_KEY = "glide-last-connection";

export function readLastConnection(): LastConnection | null {
  const saved = localStorage.getItem(LAST_CONNECTION_KEY);
  if (!saved) return null;
  try {
    const parsed = JSON.parse(saved) as Partial<LastConnection>;
    if (parsed.sessionId && parsed.pin) {
      return { sessionId: parsed.sessionId, pin: parsed.pin };
    }
  } catch {
    // Donnée corrompue, ignorée : l'utilisateur retapera le PIN.
  }
  return null;
}

export function saveLastConnection(connection: LastConnection): void {
  localStorage.setItem(LAST_CONNECTION_KEY, JSON.stringify(connection));
}

export function clearLastConnection(): void {
  localStorage.removeItem(LAST_CONNECTION_KEY);
}

// Le lien/QR encode `#s=<sessionId>` (voir showPINWindow côté serveur) : le
// PIN ne transite jamais par l'URL, seule la session est connue à l'avance.
export function parseSessionIdFromHash(hash: string): string | null {
  const match = hash.match(/^#s=(.+)$/);
  return match ? decodeURIComponent(match[1]) : null;
}
