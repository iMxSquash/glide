import { useEffect, useRef } from "react";
import { BrowserQRCodeReader } from "@zxing/library";
import { parseSessionIdFromHash } from "../lib/session";

interface QrScannerProps {
  onScanned: (sessionId: string) => void;
  onCancel: () => void;
}

export function QrScanner({ onScanned, onCancel }: QrScannerProps) {
  const videoRef = useRef<HTMLVideoElement>(null);
  const codeReaderRef = useRef<BrowserQRCodeReader | null>(null);

  useEffect(() => {
    if (!videoRef.current) return;

    const scan = async () => {
      try {
        codeReaderRef.current = new BrowserQRCodeReader();
        await codeReaderRef.current.decodeFromVideoDevice(
          null,
          videoRef.current!,
          (result) => {
            if (result) {
              try {
                // Le QR encode un lien https://pwa-url/#s=<sessionId> (voir
                // showPINWindow côté serveur), le PIN n'y est pas : il reste
                // à saisir une fois la session connue.
                const url = new URL(result.getText());
                const scannedSessionId = parseSessionIdFromHash(url.hash);
                if (!scannedSessionId) throw new Error("No session in QR code");
                codeReaderRef.current?.reset();
                codeReaderRef.current = null;
                onScanned(scannedSessionId);
              } catch (e) {
                console.error("Invalid QR code", e);
              }
            }
          },
        );
      } catch {
        alert("Camera access denied");
        onCancel();
      }
    };
    scan();

    return () => {
      codeReaderRef.current?.reset();
      codeReaderRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <>
      <video
        ref={videoRef}
        className="w-full h-64 bg-background rounded-xl mb-4"
        autoPlay
        playsInline
      />
      <button
        onClick={onCancel}
        className="w-full bg-secondary text-background font-medium py-3 rounded-xl mb-3"
      >
        Cancel
      </button>
    </>
  );
}
