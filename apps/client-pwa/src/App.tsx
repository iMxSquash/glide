import { useState, useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";
import { BrowserQRCodeReader } from "@zxing/library";

interface PointerState {
  id: number;
  x: number;
  y: number;
}

export default function App() {
  const [pin, setPin] = useState("");
  const [serverIP, setServerIP] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [isConnecting, setIsConnecting] = useState(false);
  const [showPinModal, setShowPinModal] = useState(true);
  const [isScanning, setIsScanning] = useState(false);
  const [showManualIP, setShowManualIP] = useState(false);
  const [volume, setVolume] = useState(50);
  const socketRef = useRef<Socket | null>(null);
  const trackpadRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const codeReaderRef = useRef<BrowserQRCodeReader | null>(null);
  const pointersRef = useRef<Map<number, PointerState>>(new Map());
  const lastPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });
  const pointerDownTimeRef = useRef<number>(0);
  const hasMovedRef = useRef<boolean>(false);

  useEffect(() => {
    const handleVolumeKeys = (e: KeyboardEvent) => {
      if (e.key === "VolumeUp" && socketRef.current) {
        socketRef.current.emit("volumeUp");
        setVolume((v) => Math.min(100, v + 10));
      } else if (e.key === "VolumeDown" && socketRef.current) {
        socketRef.current.emit("volumeDown");
        setVolume((v) => Math.max(0, v - 10));
      }
    };

    window.addEventListener("keydown", handleVolumeKeys);
    return () => window.removeEventListener("keydown", handleVolumeKeys);
  }, []);

  const connectWithPin = async (ip: string, pinCode: string) => {
    setIsConnecting(true);

    // Détecte si hébergé par le serveur Electron (même origine)
    const isHostedByServer =
      window.location.protocol === "https:" && window.location.port === "3000";
    const targetURL = isHostedByServer
      ? `${window.location.protocol}//${window.location.hostname}:${window.location.port}`
      : `https://${ip.replace(/:3000$/, "").trim()}:3000`;

    console.log(`Connexion à : ${targetURL} avec PIN ${pinCode}`);

    const socket = io(targetURL, {
      auth: { pin: pinCode },
      transports: ["websocket"],
      timeout: 10000,
      reconnectionAttempts: 3,
      rejectUnauthorized: false,
    });

    socket.on("connect", () => {
      console.log("✅ Connexion réussie !");
      setIsConnected(true);
      setIsConnecting(false);
      setShowPinModal(false);
      setServerIP(ip.replace(/:3000$/, "").trim());
      socketRef.current = socket;
    });

    socket.on("connect_error", (error) => {
      console.error("❌ Erreur connexion:", error);
      setIsConnecting(false);
      alert(
        `Connection failed: ${error.message}\n\nVérifier:\n1. Serveur lancé\n2. Windows Firewall autorise port 3000\n3. Téléphone et PC sur même WiFi`,
      );
    });
  };

  const findServerAndConnect = async () => {
    if (pin.length !== 6) return;

    // Si IP manuelle fournie, l'utiliser directement
    if (serverIP) {
      connectWithPin(serverIP, pin);
      return;
    }

    // Sinon demander à l'utilisateur d'entrer l'IP
    setIsConnecting(false);
    alert("Please enter the server IP address shown on your PC.");
    setShowManualIP(true);
  };

  const startQRScan = () => {
    setIsScanning(true);
  };

  const stopQRScan = () => {
    if (codeReaderRef.current) {
      codeReaderRef.current.reset();
      codeReaderRef.current = null;
    }
    setIsScanning(false);
  };

  useEffect(() => {
    if (isScanning && videoRef.current) {
      const scan = async () => {
        try {
          codeReaderRef.current = new BrowserQRCodeReader();
          await codeReaderRef.current.decodeFromVideoDevice(
            null,
            videoRef.current!,
            (result) => {
              if (result) {
                try {
                  const data = JSON.parse(result.getText());
                  stopQRScan();
                  connectWithPin(data.ip, data.pin);
                } catch (e) {
                  console.error("Invalid QR code", e);
                }
              }
            },
          );
        } catch (err) {
          alert("Camera access denied");
          setIsScanning(false);
        }
      };
      scan();
    }
  }, [isScanning]);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const rect = trackpadRef.current?.getBoundingClientRect();
    if (!rect) return;

    pointersRef.current.set(e.pointerId, {
      id: e.pointerId,
      x: e.nativeEvent.clientX - rect.left,
      y: e.nativeEvent.clientY - rect.top,
    });

    trackpadRef.current?.setPointerCapture(e.pointerId);

    if (pointersRef.current.size === 1) {
      lastPosRef.current = {
        x: e.nativeEvent.clientX,
        y: e.nativeEvent.clientY,
      };
      pointerDownTimeRef.current = Date.now();
      hasMovedRef.current = false;
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (pointersRef.current.size !== 1 || !socketRef.current) return;

    const deltaX = (e.nativeEvent.clientX - lastPosRef.current.x) * 2;
    const deltaY = (e.nativeEvent.clientY - lastPosRef.current.y) * 2;

    if (Math.abs(deltaX) > 2 || Math.abs(deltaY) > 2) {
      hasMovedRef.current = true;
      socketRef.current.emit("mouseDelta", { x: deltaX, y: deltaY });
    }

    lastPosRef.current = { x: e.nativeEvent.clientX, y: e.nativeEvent.clientY };
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const wasSingleTouch = pointersRef.current.size === 1;
    const wasTwoTouches = pointersRef.current.size === 2;
    const tapDuration = Date.now() - pointerDownTimeRef.current;

    pointersRef.current.delete(e.pointerId);
    trackpadRef.current?.releasePointerCapture(e.pointerId);

    if (socketRef.current) {
      // Tap 2 doigts = right click
      if (wasTwoTouches && tapDuration < 300 && !hasMovedRef.current) {
        socketRef.current.emit("rightClick");
      }
      // Tap 1 doigt = left click
      else if (wasSingleTouch && tapDuration < 300 && !hasMovedRef.current) {
        socketRef.current.emit("leftClick");
      }
    }
  };

  if (showPinModal) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="bg-surface rounded-2xl p-8 w-full max-w-sm">
          <h1 className="text-3xl font-bold text-accent mb-2">Glide</h1>
          <p className="text-secondary mb-6">Enter PIN from your PC</p>

          {isScanning ? (
            <>
              <video
                ref={videoRef}
                className="w-full h-64 bg-background rounded-xl mb-4"
                autoPlay
                playsInline
              />
              <button
                onClick={stopQRScan}
                className="w-full bg-secondary text-background font-medium py-3 rounded-xl mb-3"
              >
                Cancel
              </button>
            </>
          ) : (
            <>
              <input
                type="text"
                placeholder="192.168.0.50 (IP only)"
                value={serverIP}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setServerIP(e.target.value)
                }
                className="w-full bg-background text-primary text-center p-3 rounded-xl mb-3 focus:outline-none focus:ring-2 focus:ring-accent text-sm"
                disabled={isConnecting}
              />

              <input
                type="text"
                inputMode="numeric"
                maxLength={6}
                value={pin}
                onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
                  setPin(e.target.value.replace(/\D/g, ""))
                }
                className="w-full bg-background text-primary text-center text-3xl tracking-widest p-4 rounded-xl mb-4 focus:outline-none focus:ring-2 focus:ring-accent"
                placeholder="000000"
                disabled={isConnecting}
              />

              <button
                onClick={findServerAndConnect}
                disabled={pin.length !== 6 || !serverIP || isConnecting}
                className="w-full bg-accent text-background font-medium py-3 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed flex items-center justify-center gap-2 mb-3"
              >
                {isConnecting ? (
                  <>
                    <svg className="animate-spin h-5 w-5" viewBox="0 0 24 24">
                      <circle
                        className="opacity-25"
                        cx="12"
                        cy="12"
                        r="10"
                        stroke="currentColor"
                        strokeWidth="4"
                        fill="none"
                      />
                      <path
                        className="opacity-75"
                        fill="currentColor"
                        d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4zm2 5.291A7.962 7.962 0 014 12H0c0 3.042 1.135 5.824 3 7.938l3-2.647z"
                      />
                    </svg>
                    Connecting...
                  </>
                ) : (
                  "Connect"
                )}
              </button>

              <button
                onClick={startQRScan}
                disabled={isConnecting}
                className="w-full bg-surface-light text-primary font-medium py-3 rounded-xl disabled:opacity-50 flex items-center justify-center gap-2"
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M12 4v1m6 11h2m-6 0h-2v4m0-11v3m0 0h.01M12 12h4.01M16 20h4M4 12h4m12 0h.01M5 8h2a1 1 0 001-1V5a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1zm12 0h2a1 1 0 001-1V5a1 1 0 00-1-1h-2a1 1 0 00-1 1v2a1 1 0 001 1zM5 20h2a1 1 0 001-1v-2a1 1 0 00-1-1H5a1 1 0 00-1 1v2a1 1 0 001 1z"
                  />
                </svg>
                Scan QR Code
              </button>
            </>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background flex flex-col">
      <div className="flex items-center justify-between p-4">
        <h1 className="text-xl font-bold text-accent">Glide</h1>
        <div className="text-sm text-secondary">PIN: {pin}</div>
      </div>

      <div
        ref={trackpadRef}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerUp}
        onPointerCancel={handlePointerUp}
        className="flex-1 bg-surface m-4 rounded-2xl min-h-[200px] touch-none"
      />

      <div className="p-6 bg-surface m-4 rounded-2xl">
        <div className="flex items-center justify-between mb-3">
          <span className="text-secondary">Volume</span>
          <span className="text-primary font-medium">{volume}%</span>
        </div>
        <div className="flex items-center gap-3">
          <button
            onClick={() => {
              socketRef.current?.emit("volumeDown");
              setVolume((v) => Math.max(0, v - 10));
            }}
            className="w-12 h-12 bg-background rounded-xl text-primary font-bold"
          >
            −
          </button>
          <input
            type="range"
            min="0"
            max="100"
            value={volume}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setVolume(Number(e.target.value))
            }
            className="flex-1"
          />
          <button
            onClick={() => {
              socketRef.current?.emit("volumeUp");
              setVolume((v) => Math.min(100, v + 10));
            }}
            className="w-12 h-12 bg-background rounded-xl text-primary font-bold"
          >
            +
          </button>
        </div>
      </div>
    </div>
  );
}
