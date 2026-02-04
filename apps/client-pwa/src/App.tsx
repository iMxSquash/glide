import { useState, useEffect, useRef } from "react";
import { io, Socket } from "socket.io-client";

interface PointerState {
  id: number;
  x: number;
  y: number;
}

export default function App() {
  const [pin, setPin] = useState("");
  const [isConnected, setIsConnected] = useState(false);
  const [showPinModal, setShowPinModal] = useState(true);
  const [volume, setVolume] = useState(50);
  const socketRef = useRef<Socket | null>(null);
  const trackpadRef = useRef<HTMLDivElement>(null);
  const pointersRef = useRef<Map<number, PointerState>>(new Map());
  const lastPosRef = useRef<{ x: number; y: number }>({ x: 0, y: 0 });

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

  const connectToServer = () => {
    if (pin.length !== 6) return;

    const socket = io("wss://192.168.1.100:3000", {
      auth: { pin },
      transports: ["websocket"],
    });

    socket.on("connect", () => {
      setIsConnected(true);
      setShowPinModal(false);
      socketRef.current = socket;
    });

    socket.on("connect_error", () => {
      alert("Invalid PIN or connection failed");
    });
  };

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
    } else if (pointersRef.current.size === 2 && socketRef.current) {
      socketRef.current.emit("rightClick");
    }
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    if (pointersRef.current.size !== 1 || !socketRef.current) return;

    const deltaX = (e.nativeEvent.clientX - lastPosRef.current.x) * 2;
    const deltaY = (e.nativeEvent.clientY - lastPosRef.current.y) * 2;

    if (Math.abs(deltaX) > 0 || Math.abs(deltaY) > 0) {
      socketRef.current.emit("mouseDelta", { x: deltaX, y: deltaY });
    }

    lastPosRef.current = { x: e.nativeEvent.clientX, y: e.nativeEvent.clientY };
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    e.preventDefault();
    const wasSingleTouch = pointersRef.current.size === 1;

    pointersRef.current.delete(e.pointerId);
    trackpadRef.current?.releasePointerCapture(e.pointerId);

    if (wasSingleTouch && socketRef.current) {
      const timeSinceLast = Date.now();
      if (timeSinceLast < 200) {
        socketRef.current.emit("leftClick");
      }
    }
  };

  if (showPinModal) {
    return (
      <div className="min-h-screen bg-background flex items-center justify-center p-6">
        <div className="bg-surface rounded-2xl p-8 w-full max-w-sm">
          <h1 className="text-3xl font-bold text-accent mb-2">Glide</h1>
          <p className="text-secondary mb-6">Enter your PC PIN</p>
          <input
            type="text"
            inputMode="numeric"
            maxLength={6}
            value={pin}
            onChange={(e: React.ChangeEvent<HTMLInputElement>) =>
              setPin(e.target.value.replace(/\D/g, ""))
            }
            className="w-full bg-background text-primary text-center text-2xl tracking-widest p-4 rounded-xl mb-4 focus:outline-none focus:ring-2 focus:ring-accent"
            placeholder="000000"
          />
          <button
            onClick={connectToServer}
            disabled={pin.length !== 6}
            className="w-full bg-accent text-background font-medium py-3 rounded-xl disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Connect
          </button>
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
