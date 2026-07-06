import { app, BrowserWindow, Tray, Menu, nativeImage } from "electron";
import { Server } from "socket.io";
import * as https from "https";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as QRCode from "qrcode";
import { mouse } from "@nut-tree-fork/nut-js";
import express from "express";
import { execSync } from "child_process";
import loudness from "loudness";

const PORT = 3000;
const MOUSE_TICK_HZ = 120;
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let io: Server | null = null;
let currentPIN: string = "";
let localIP: string = "";
let isServerRunning = false;

// Deltas de souris accumulés entre deux ticks, appliqués en un seul setPosition
// (au lieu d'un aller-retour getPosition/setPosition par message reçu, qui sature
// nut-js et fait sauter/ramer le curseur).
let pendingMouseDelta = { x: 0, y: 0 };
let cursorPosition: { x: number; y: number } | null = null;
let isApplyingMousePosition = false;

function startMouseTickLoop(): void {
  setInterval(async () => {
    if (isApplyingMousePosition) return;

    if (pendingMouseDelta.x === 0 && pendingMouseDelta.y === 0) {
      // Rien à appliquer : on invalide la position mise en cache pour se
      // resynchroniser avec la position réelle au prochain mouvement (au cas
      // où le curseur ait été déplacé par autre chose entre-temps).
      cursorPosition = null;
      return;
    }

    const delta = pendingMouseDelta;
    pendingMouseDelta = { x: 0, y: 0 };
    isApplyingMousePosition = true;
    try {
      if (!cursorPosition) {
        cursorPosition = await mouse.getPosition();
      }
      cursorPosition = {
        x: cursorPosition.x + delta.x,
        y: cursorPosition.y + delta.y,
      };
      await mouse.setPosition(cursorPosition);
    } finally {
      isApplyingMousePosition = false;
    }
  }, 1000 / MOUSE_TICK_HZ);
}

/**
 * @returns {string} Local IP address
 */
function getLocalIP(): string {
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name]!) {
      if (iface.family === "IPv4" && !iface.internal) {
        return iface.address;
      }
    }
  }
  return "localhost";
}

/**
 * @returns {string} Random 6-digit PIN
 */
function generatePIN(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

interface CertificateMeta {
  ip: string;
}

/**
 * Génère (ou réutilise) un certificat TLS persisté dans userData. Régénérer à
 * chaque lancement forçait le téléphone à ré-accepter le certificat à chaque
 * fois, avec des connexions WSS qui échouaient silencieusement entre-temps.
 * On ne régénère que si l'IP locale a changé (elle est dans le SAN du cert).
 *
 * @param {string} ip Local IP address to embed in the certificate's SAN
 * @returns {{ key: string; cert: string }} TLS key/cert pair
 */
function getOrCreateCertificate(ip: string): { key: string; cert: string } {
  const userDataDir = app.getPath("userData");
  const certPath = path.join(userDataDir, "cert.pem");
  const keyPath = path.join(userDataDir, "key.pem");
  const metaPath = path.join(userDataDir, "cert-meta.json");

  if (fs.existsSync(certPath) && fs.existsSync(keyPath) && fs.existsSync(metaPath)) {
    try {
      const meta: CertificateMeta = JSON.parse(fs.readFileSync(metaPath, "utf8"));
      if (meta.ip === ip) {
        return {
          key: fs.readFileSync(keyPath, "utf8"),
          cert: fs.readFileSync(certPath, "utf8"),
        };
      }
      console.log(`IP changée (${meta.ip} → ${ip}), régénération du certificat...`);
    } catch {
      console.warn("Métadonnées de certificat illisibles, régénération...");
    }
  }

  const selfsigned = require("selfsigned");
  const attrs = [
    { name: "commonName", value: ip },
    { name: "organizationName", value: "Glide" },
  ];
  const pems = selfsigned.generate(attrs, {
    days: 365,
    keySize: 2048,
    algorithm: "sha256",
    extensions: [
      {
        name: "subjectAltName",
        altNames: [
          { type: 2, value: "localhost" },
          { type: 2, value: ip },
          { type: 7, ip: "127.0.0.1" },
          { type: 7, ip },
        ],
      },
    ],
  });

  fs.mkdirSync(userDataDir, { recursive: true });
  fs.writeFileSync(certPath, pems.cert);
  fs.writeFileSync(keyPath, pems.private);
  fs.writeFileSync(metaPath, JSON.stringify({ ip } satisfies CertificateMeta));

  return { key: pems.private, cert: pems.cert };
}

/**
 * @param {string} cmd
 * @returns {boolean}
 */
function execCommand(cmd: string): boolean {
  try {
    execSync(cmd, { stdio: "ignore" });
    return true;
  } catch (error) {
    console.error(`Command failed: ${cmd}`);
    return false;
  }
}

/**
 * Open firewall port on Windows
 */
function openFirewallPort(): void {
  if (process.platform !== "win32") return;

  console.log(`Opening port ${PORT} in Windows Firewall...`);
  const ruleName = `Glide_${PORT}`;

  // Delete existing rule
  execCommand(`netsh advfirewall firewall delete rule name="${ruleName}"`);

  // Add new rule
  const success = execCommand(
    `netsh advfirewall firewall add rule name="${ruleName}" dir=in action=allow protocol=TCP localport=${PORT}`,
  );

  if (success) {
    console.log(`✅ Port ${PORT} opened in Windows Firewall`);
  } else {
    console.warn(`⚠️  Could not open port. May need administrator rights.`);
  }
}

/**
 * Close firewall port on Windows
 */
function closeFirewallPort(): void {
  if (process.platform !== "win32") return;

  console.log(`Closing port ${PORT} in Windows Firewall...`);
  const ruleName = `Glide_${PORT}`;
  execCommand(`netsh advfirewall firewall delete rule name="${ruleName}"`);
}

/**
 * @returns {{ volume: number; muted: boolean }} Real system volume, read via the
 * `loudness` lib (not a locally-guessed counter).
 */
async function getVolumeState(): Promise<{ volume: number; muted: boolean }> {
  const [volume, muted] = await Promise.all([
    loudness.getVolume(),
    loudness.getMuted(),
  ]);
  return { volume, muted };
}

/**
 * Reads the real system volume and broadcasts it to every connected client,
 * so all devices stay in sync with the actual PC volume.
 */
async function broadcastVolumeState(): Promise<void> {
  try {
    const state = await getVolumeState();
    io?.emit("volumeState", state);
  } catch (error) {
    console.error("Failed to read system volume:", error);
  }
}

/**
 * Start Socket.io server (HTTPS with self-signed cert)
 */
function startServer(): void {
  openFirewallPort();

  const { key, cert } = getOrCreateCertificate(localIP);

  const expressApp = express();

  // Serve PWA static files
  const isDev = !app.isPackaged;
  const pwaPath = isDev
    ? path.join(__dirname, "../../../../dist/apps/client-pwa")
    : path.join(process.resourcesPath, "dist/apps/client-pwa");

  if (fs.existsSync(pwaPath)) {
    console.log(`✅ Serving PWA from: ${pwaPath}`);
    expressApp.use(express.static(pwaPath));
    expressApp.get("*", (req, res) => {
      res.sendFile(path.join(pwaPath, "index.html"));
    });
  } else {
    console.warn(`⚠️  PWA not found at: ${pwaPath}`);
    console.warn(`Run 'npm run build:client' first`);
  }

  const httpsServer = https.createServer({ key, cert }, expressApp);

  io = new Server(httpsServer, {
    cors: { origin: "*" },
    transports: ["websocket"],
  });

  io.use((socket, next) => {
    const pin = socket.handshake.auth.pin;
    if (pin === currentPIN) {
      next();
    } else {
      next(new Error("Invalid PIN"));
    }
  });

  io.on("connection", (socket) => {
    console.log("Client connected");

    getVolumeState()
      .then((state) => socket.emit("volumeState", state))
      .catch((error) => console.error("Failed to read system volume:", error));

    socket.on("mouseDelta", (data: { x: number; y: number }) => {
      pendingMouseDelta.x += data.x;
      pendingMouseDelta.y += data.y;
    });

    socket.on("leftClick", async () => {
      await mouse.leftClick();
    });

    socket.on("rightClick", async () => {
      await mouse.rightClick();
    });

    socket.on("volumeUp", async () => {
      const current = await loudness.getVolume();
      await loudness.setVolume(Math.min(100, current + 10));
      await broadcastVolumeState();
    });

    socket.on("volumeDown", async () => {
      const current = await loudness.getVolume();
      await loudness.setVolume(Math.max(0, current - 10));
      await broadcastVolumeState();
    });

    socket.on("setVolume", async (value: number) => {
      await loudness.setVolume(Math.max(0, Math.min(100, Math.round(value))));
      await broadcastVolumeState();
    });

    socket.on("toggleMute", async () => {
      const muted = await loudness.getMuted();
      await loudness.setMuted(!muted);
      await broadcastVolumeState();
    });

    socket.on("disconnect", () => {
      console.log("Client disconnected");
    });
  });

  httpsServer.listen(PORT, "0.0.0.0", () => {
    console.log(`\n🚀 Glide server running`);
    console.log(`   Local:   https://0.0.0.0:${PORT}`);
    console.log(`   Network: https://${localIP}:${PORT}`);
    console.log(`   PIN:     ${currentPIN}\n`);
    isServerRunning = true;
  });

  startMouseTickLoop();
}

/**
 * Create tray icon
 */
function createTray(): void {
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip("Glide - Remote PC Control");

  tray.on("click", () => {
    showPINWindow();
  });

  tray.on("double-click", () => {
    showPINWindow();
  });

  const updateMenu = () => {
    const contextMenu = Menu.buildFromTemplate([
      {
        label: `PIN: ${currentPIN}`,
        enabled: false,
      },
      {
        label: `IP: ${localIP}:3000`,
        enabled: false,
      },
      { type: "separator" },
      {
        label: "Show PIN Window",
        click: () => {
          showPINWindow();
        },
      },
      {
        label: isServerRunning ? "Pause Server" : "Resume Server",
        click: () => {
          isServerRunning = !isServerRunning;
          updateMenu();
        },
      },
      { type: "separator" },
      {
        label: "Quit",
        click: () => {
          app.exit(0);
        },
      },
    ]);
    tray?.setContextMenu(contextMenu);
  };

  updateMenu();
}

/**
 * Show PIN in a window
 */
async function showPINWindow(): Promise<void> {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 400,
    height: 550,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    backgroundColor: "#0E0F12",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const qrData = JSON.stringify({ ip: localIP, pin: currentPIN });
  const qrCodeDataURL = await QRCode.toDataURL(qrData, {
    width: 250,
    color: { dark: "#6EE7B7", light: "#0E0F12" },
  });

  const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    body {
      background: #0E0F12;
      color: #F2F2F3;
      font-family: 'Segoe UI', system-ui, sans-serif;
      display: flex;
      align-items: center;
      justify-content: center;
      height: 100vh;
      width: 100vw;
      padding: 30px;
    }
    .container { text-align: center; width: 100%; }
    h1 {
      color: #6EE7B7;
      font-size: 20px;
      font-weight: 600;
      margin-bottom: 20px;
    }
    .pin {
      font-size: 56px;
      font-weight: 700;
      letter-spacing: 8px;
      color: #F2F2F3;
      margin: 20px 0;
    }
    .info {
      color: #9A9DA3;
      font-size: 14px;
      margin-top: 15px;
      margin-bottom: 20px;
    }
    button {
      background: #16181D;
      color: #F2F2F3;
      border: none;
      padding: 12px 24px;
      border-radius: 8px;
      font-size: 14px;
      cursor: pointer;
      margin-top: 10px;
    }
    button:hover { background: #1C1E24; }
    #qrContainer {
      margin-top: 10px;
      display: none;
    }
    #qrContainer.show {
      display: block;
    }
    img { 
      width: 250px; 
      height: 250px;
      margin: 10px auto;
      border-radius: 12px;
    }
  </style>
</head>
<body>
  <div class="container">
    <h1>Glide Server</h1>
    <div class="pin">${currentPIN}</div>
    <p class="info">Open on iPhone:</p>
    <p class="info" style="color: #6EE7B7; font-size: 16px; font-weight: 500;">https://${localIP}:3000</p>
    <button id="toggleBtn">Show QR Code</button>
    <div id="qrContainer">
      <img src="${qrCodeDataURL}" alt="QR Code" />
    </div>
  </div>
  <script>
    const btn = document.getElementById('toggleBtn');
    const qr = document.getElementById('qrContainer');
    let isShowing = false;
    
    btn.addEventListener('click', () => {
      isShowing = !isShowing;
      if (isShowing) {
        qr.classList.add('show');
        btn.textContent = 'Hide QR Code';
      } else {
        qr.classList.remove('show');
        btn.textContent = 'Show QR Code';
      }
    });
  </script>
</body>
</html>`;

  mainWindow.loadURL(
    `data:text/html;charset=utf-8,${encodeURIComponent(htmlContent)}`,
  );

  mainWindow.on("blur", () => {
    mainWindow?.hide();
  });

  mainWindow.on("close", (event) => {
    event.preventDefault();
    mainWindow?.hide();
  });

  mainWindow.on("closed", () => {
    mainWindow = null;
  });
}

app.whenReady().then(() => {
  localIP = getLocalIP();
  currentPIN = generatePIN();
  startServer();
  createTray();
  showPINWindow();

  // Hide from dock on macOS (run in background only)
  if (process.platform === "darwin") {
    app.dock.hide();
  }
});

app.on("window-all-closed", () => {
  // Keep app running in tray
});

app.on("before-quit", () => {
  // Close firewall port on Windows before quitting
  closeFirewallPort();

  // Allow actual quit
  if (mainWindow) {
    mainWindow.removeAllListeners("close");
  }
});
