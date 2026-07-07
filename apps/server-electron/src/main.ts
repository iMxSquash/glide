import { app, BrowserWindow, Tray, Menu, nativeImage } from "electron";
import { Server } from "socket.io";
import * as https from "https";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as QRCode from "qrcode";
import { mouse, keyboard, Button, Key } from "@nut-tree-fork/nut-js";
import express from "express";
import { execSync } from "child_process";
import loudness from "loudness";
import type {
  AuthPayload,
  ClientToServerEvents,
  ServerToClientEvents,
} from "@glide/shared-types";

const DEFAULT_PORT = 3000;
const MAX_PORT_ATTEMPTS = 10;
const MOUSE_TICK_HZ = 120;
const PIN_MAX_ATTEMPTS = 5;
const PIN_BLOCK_DURATION_MS = 5 * 60 * 1000;

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let updateTrayMenu: (() => void) | null = null;
let io: Server<ClientToServerEvents, ServerToClientEvents> | null = null;
let currentPIN: string = "";
let localIP: string = "";
let networkCandidates: string[] = [];
let activePort = DEFAULT_PORT;
let isServerRunning = false;
let connectedClientCount = 0;

// Une seule instance du serveur à la fois (sinon deux process se battent sur
// le même port et l'un des deux échoue silencieusement).
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

// Deltas de souris accumulés entre deux ticks, appliqués en un seul setPosition
// (au lieu d'un aller-retour getPosition/setPosition par message reçu, qui sature
// nut-js et fait sauter/ramer le curseur).
let pendingMouseDelta = { x: 0, y: 0 };
let cursorPosition: { x: number; y: number } | null = null;
let isApplyingMousePosition = false;

// Deltas de scroll (2 doigts) accumulés en pixels, convertis en "steps" nut-js
// (l'unité de scrollUp/Down/Left/Right est OS-dépendante, pas le pixel).
let pendingScrollDelta = { x: 0, y: 0 };
const SCROLL_PIXELS_PER_STEP = 1;

async function applyPendingScroll(): Promise<void> {
  const stepsY = Math.trunc(pendingScrollDelta.y / SCROLL_PIXELS_PER_STEP);
  const stepsX = Math.trunc(pendingScrollDelta.x / SCROLL_PIXELS_PER_STEP);
  if (stepsY === 0 && stepsX === 0) return;

  // Le reste (< 1 step) est conservé pour le prochain tick, sinon les petits
  // mouvements de scroll s'accumulent puis se perdent (curseur qui "colle").
  pendingScrollDelta.y -= stepsY * SCROLL_PIXELS_PER_STEP;
  pendingScrollDelta.x -= stepsX * SCROLL_PIXELS_PER_STEP;

  if (stepsY > 0) await mouse.scrollDown(stepsY);
  else if (stepsY < 0) await mouse.scrollUp(-stepsY);

  if (stepsX > 0) await mouse.scrollRight(stepsX);
  else if (stepsX < 0) await mouse.scrollLeft(-stepsX);
}

function startMouseTickLoop(): void {
  setInterval(async () => {
    await applyPendingScroll();

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

// Interfaces virtuelles connues (VPN, machines virtuelles, conteneurs...) à
// exclure de la détection auto, sinon `getLocalIP()` peut renvoyer une IP
// injoignable depuis le téléphone (ex: adaptateur VirtualBox/VMware).
const VIRTUAL_INTERFACE_PATTERNS = [
  /virtualbox/i,
  /vmware/i,
  /vethernet/i,
  /hyper-v/i,
  /docker/i,
  /wsl/i,
  /tailscale/i,
  /zerotier/i,
  /loopback/i,
  /^utun/i,
  /^tun\d*/i,
  /^tap\d*/i,
];

function isVirtualInterfaceName(name: string): boolean {
  return VIRTUAL_INTERFACE_PATTERNS.some((pattern) => pattern.test(name));
}

/**
 * @returns {string[]} Toutes les IPv4 locales non-internes, hors interfaces
 * virtuelles connues.
 */
function getNetworkCandidates(): string[] {
  const interfaces = os.networkInterfaces();
  const candidates: string[] = [];
  for (const name of Object.keys(interfaces)) {
    if (isVirtualInterfaceName(name)) continue;
    for (const iface of interfaces[name] ?? []) {
      if (iface.family === "IPv4" && !iface.internal) {
        candidates.push(iface.address);
      }
    }
  }
  return candidates;
}

/**
 * @returns {string} Local IP address
 */
function getLocalIP(): string {
  const candidates = getNetworkCandidates();
  if (candidates.length > 0) return candidates[0];

  // Repli : aucune interface "réelle" détectée, on retente sans filtrer les
  // interfaces virtuelles plutôt que de renvoyer localhost.
  const interfaces = os.networkInterfaces();
  for (const name of Object.keys(interfaces)) {
    for (const iface of interfaces[name] ?? []) {
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
async function getOrCreateCertificate(ip: string): Promise<{ key: string; cert: string }> {
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
  const pems = await selfsigned.generate(attrs, {
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
 * @param {number} port Port to open (the port actually bound, may differ from
 * DEFAULT_PORT if it was already taken)
 */
function openFirewallPort(port: number): void {
  if (process.platform !== "win32") return;

  console.log(`Opening port ${port} in Windows Firewall...`);
  const ruleName = `Glide_${port}`;

  // Delete existing rule
  execCommand(`netsh advfirewall firewall delete rule name="${ruleName}"`);

  // Add new rule
  const success = execCommand(
    `netsh advfirewall firewall add rule name="${ruleName}" dir=in action=allow protocol=TCP localport=${port}`,
  );

  if (success) {
    console.log(`✅ Port ${port} opened in Windows Firewall`);
  } else {
    console.warn(`⚠️  Could not open port. May need administrator rights.`);
  }
}

/**
 * Close firewall port on Windows
 * @param {number} port Port that was opened by `openFirewallPort`
 */
function closeFirewallPort(port: number): void {
  if (process.platform !== "win32") return;

  console.log(`Closing port ${port} in Windows Firewall...`);
  const ruleName = `Glide_${port}`;
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
 * Reflects the number of connected devices in the tray tooltip/menu and, if
 * open, the PIN window ("1 appareil connecté").
 * @param {number} count Number of currently connected sockets
 */
function setConnectedClientCount(count: number): void {
  connectedClientCount = count;

  const label =
    count > 0
      ? `${count} appareil${count > 1 ? "s" : ""} connecté${count > 1 ? "s" : ""}`
      : "Aucun appareil connecté";

  tray?.setToolTip(`Glide - Remote PC Control${count > 0 ? ` (${label})` : ""}`);
  updateTrayMenu?.();

  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.webContents
      .executeJavaScript(
        `(() => { const el = document.getElementById('clientCount'); if (el) el.textContent = ${JSON.stringify(label)}; })();`,
      )
      .catch(() => {});
  }
}

/**
 * Pauses/resumes the server: while paused, new connections are refused and
 * every currently connected client is disconnected.
 * @param {boolean} running Whether the server should accept connections
 */
function setServerRunning(running: boolean): void {
  isServerRunning = running;
  if (!running) {
    io?.disconnectSockets(true);
  }
  updateTrayMenu?.();
}

interface PinAttemptRecord {
  count: number;
  blockedUntil: number;
}

// Bloque une IP après quelques PIN faux, sinon un brute-force du code à 6
// chiffres en local est trivial.
const pinAttempts = new Map<string, PinAttemptRecord>();

function registerFailedPinAttempt(ip: string, existing?: PinAttemptRecord): void {
  const count = (existing?.count ?? 0) + 1;
  const blockedUntil =
    count >= PIN_MAX_ATTEMPTS ? Date.now() + PIN_BLOCK_DURATION_MS : 0;
  pinAttempts.set(ip, { count, blockedUntil });
}

/**
 * Binds the HTTPS server, retrying on the next port if the current one is
 * already taken (instead of crashing silently on EADDRINUSE).
 * @param {https.Server} httpsServer Server to bind
 * @param {number} port First port to try
 * @param {number} attempt Retry counter (internal)
 * @returns {Promise<number>} The port that was actually bound
 */
function listenWithPortFallback(
  httpsServer: https.Server,
  port: number,
  attempt = 0,
): Promise<number> {
  return new Promise((resolve, reject) => {
    const onError = (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE" && attempt < MAX_PORT_ATTEMPTS) {
        console.warn(`⚠️  Port ${port} occupé, essai sur ${port + 1}...`);
        resolve(listenWithPortFallback(httpsServer, port + 1, attempt + 1));
      } else {
        reject(err);
      }
    };

    httpsServer.once("error", onError);
    httpsServer.listen(port, "0.0.0.0", () => {
      httpsServer.removeListener("error", onError);
      resolve(port);
    });
  });
}

/**
 * Start Socket.io server (HTTPS with self-signed cert)
 */
async function startServer(): Promise<void> {
  const { key, cert } = await getOrCreateCertificate(localIP);

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

  io = new Server<ClientToServerEvents, ServerToClientEvents>(httpsServer, {
    cors: { origin: "*" },
    transports: ["websocket"],
  });

  io.use((socket, next) => {
    if (!isServerRunning) {
      next(new Error("Server paused"));
      return;
    }

    const ip = socket.handshake.address;
    const now = Date.now();
    const record = pinAttempts.get(ip);

    if (record && record.blockedUntil > now) {
      next(new Error("Too many attempts, try again later"));
      return;
    }

    const auth = socket.handshake.auth as AuthPayload;
    if (auth.pin === currentPIN) {
      pinAttempts.delete(ip);
      next();
      return;
    }

    registerFailedPinAttempt(ip, record);
    next(new Error("Invalid PIN"));
  });

  io.on("connection", (socket) => {
    console.log("Client connected");
    setConnectedClientCount(connectedClientCount + 1);

    getVolumeState()
      .then((state) => socket.emit("volumeState", state))
      .catch((error) => console.error("Failed to read system volume:", error));

    socket.on("mouseDelta", (data) => {
      pendingMouseDelta.x += data.x;
      pendingMouseDelta.y += data.y;
    });

    socket.on("scroll", (data) => {
      pendingScrollDelta.x += data.x;
      pendingScrollDelta.y += data.y;
    });

    socket.on("leftClick", async () => {
      await mouse.leftClick();
    });

    socket.on("rightClick", async () => {
      await mouse.rightClick();
    });

    // Drag & drop : double-tap-and-hold côté client presse le bouton, le
    // déplacement se fait via les mouseDelta déjà en cours, puis relâche au
    // pointerup.
    socket.on("mouseDown", async () => {
      await mouse.pressButton(Button.LEFT);
    });

    socket.on("mouseUp", async () => {
      await mouse.releaseButton(Button.LEFT);
    });

    socket.on("typeText", async (text) => {
      if (typeof text === "string" && text.length > 0) {
        await keyboard.type(text);
      }
    });

    socket.on("keyPress", async (key) => {
      if (key === "Enter") await keyboard.type(Key.Enter);
      else if (key === "Backspace") await keyboard.type(Key.Backspace);
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

    socket.on("setVolume", async (value) => {
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
      setConnectedClientCount(Math.max(0, connectedClientCount - 1));
      // Sécurité : si la connexion coupe pendant un drag (WiFi, verrouillage
      // écran...), le bouton gauche resterait sinon pressé indéfiniment sur le PC.
      mouse.releaseButton(Button.LEFT).catch(() => {});
    });
  });

  activePort = await listenWithPortFallback(httpsServer, DEFAULT_PORT);
  openFirewallPort(activePort);
  isServerRunning = true;

  console.log(`\n🚀 Glide server running`);
  console.log(`   Local:   https://0.0.0.0:${activePort}`);
  console.log(`   Network: https://${localIP}:${activePort}`);
  console.log(`   PIN:     ${currentPIN}\n`);

  startMouseTickLoop();
}

/**
 * Create tray icon
 */
function createTray(): void {
  // Même chemin relatif en dev et packagé : `assets/` est au même niveau que
  // `dist/` dans les deux cas (bundlé via `files` dans electron-builder).
  const trayIconPath = path.join(__dirname, "..", "..", "assets", "tray-icon.png");
  const icon = fs.existsSync(trayIconPath)
    ? nativeImage.createFromPath(trayIconPath)
    : nativeImage.createEmpty();
  tray = new Tray(icon);
  tray.setToolTip("Glide - Remote PC Control");

  tray.on("click", () => {
    showPINWindow();
  });

  tray.on("double-click", () => {
    showPINWindow();
  });

  const updateMenu = () => {
    const clientLabel =
      connectedClientCount > 0
        ? `${connectedClientCount} appareil${connectedClientCount > 1 ? "s" : ""} connecté${connectedClientCount > 1 ? "s" : ""}`
        : "Aucun appareil connecté";

    const contextMenu = Menu.buildFromTemplate([
      {
        label: `PIN: ${currentPIN}`,
        enabled: false,
      },
      {
        label: `IP: ${localIP}:${activePort}`,
        enabled: false,
      },
      {
        label: clientLabel,
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
          setServerRunning(!isServerRunning);
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

  updateTrayMenu = updateMenu;
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
    width: 760,
    height: 480,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    backgroundColor: "#0E0F12",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  // Un vrai lien https (pas du JSON) : scanné avec l'appareil photo natif du
  // téléphone (avant même d'avoir ouvert le site), il ouvre directement le
  // navigateur sur le PC — au lieu d'exiger d'être déjà sur le site pour
  // utiliser le scanner interne à la PWA. Le PIN en query string est repris
  // par la PWA au chargement pour se connecter sans ressaisie.
  const qrUrl = `https://${localIP}:${activePort}/?pin=${currentPIN}`;
  const qrCodeDataURL = await QRCode.toDataURL(qrUrl, {
    width: 250,
    color: { dark: "#6EE7B7", light: "#0E0F12" },
  });

  const clientLabel =
    connectedClientCount > 0
      ? `${connectedClientCount} appareil${connectedClientCount > 1 ? "s" : ""} connecté${connectedClientCount > 1 ? "s" : ""}`
      : "Aucun appareil connecté";

  const otherIPs = networkCandidates.filter((ip) => ip !== localIP);

  const htmlContent = `<!DOCTYPE html>
<html>
<head>
  <meta charset="UTF-8">
  <style>
    * { margin: 0; padding: 0; box-sizing: border-box; }
    html, body { height: 100%; }
    body {
      background: #0E0F12;
      color: #F2F2F3;
      font-family: 'Segoe UI', system-ui, sans-serif;
      display: flex;
      align-items: safe center;
      justify-content: center;
      min-height: 100vh;
      width: 100vw;
      padding: 30px;
      overflow-y: auto;
    }
    ::-webkit-scrollbar { width: 8px; }
    ::-webkit-scrollbar-track { background: transparent; }
    ::-webkit-scrollbar-thumb { background: #2A2D34; border-radius: 4px; }
    ::-webkit-scrollbar-thumb:hover { background: #383C45; }
    .container {
      display: flex;
      align-items: center;
      gap: 36px;
      width: 100%;
      max-width: 680px;
    }
    .text-col { flex: 1; min-width: 0; text-align: left; }
    h1 {
      color: #6EE7B7;
      font-size: 20px;
      font-weight: 600;
      margin-bottom: 16px;
    }
    .pin {
      font-size: 52px;
      font-weight: 700;
      letter-spacing: 6px;
      color: #F2F2F3;
      margin: 12px 0;
    }
    .info {
      color: #9A9DA3;
      font-size: 14px;
      margin-top: 12px;
      margin-bottom: 12px;
    }
    .steps {
      text-align: left;
      color: #9A9DA3;
      font-size: 13px;
      line-height: 1.6;
      margin: 16px 0 0;
      padding-left: 20px;
    }
    .steps li { margin-bottom: 6px; }
    .steps li::marker { color: #6EE7B7; font-weight: 600; }
    .qr-col { flex-shrink: 0; }
    img {
      width: 260px;
      height: 260px;
      border-radius: 12px;
      display: block;
    }
  </style>
</head>
<body>
  <div class="container">
    <div class="text-col">
      <h1>Glide Server</h1>
      <div class="pin">${currentPIN}</div>
      <p class="info">Open on iPhone:</p>
      <p class="info" style="color: #6EE7B7; font-size: 16px; font-weight: 500;">https://${localIP}:${activePort}</p>
      ${
        otherIPs.length > 0
          ? `<p class="info" style="font-size: 12px;">Autre IP possible si celle-ci ne fonctionne pas : ${otherIPs.join(", ")}</p>`
          : ""
      }
      <p class="info" id="clientCount" style="font-size: 12px;">${clientLabel}</p>
      <ol class="steps">
        <li>Scanne le QR code avec l'appareil photo de ton téléphone (ça ouvre directement le site — pas besoin d'avoir déjà l'app ouverte), ou tape l'URL ci-dessus dans Safari/Chrome</li>
        <li>Accepte l'avertissement de certificat — uniquement au premier lancement</li>
        <li>Le PIN se remplit tout seul depuis le QR code (sinon entre celui affiché ci-dessus)</li>
      </ol>
    </div>
    <div class="qr-col">
      <img src="${qrCodeDataURL}" alt="QR Code" />
    </div>
  </div>
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

if (gotSingleInstanceLock) {
  app.on("second-instance", () => {
    showPINWindow();
  });

  app.whenReady().then(async () => {
    networkCandidates = getNetworkCandidates();
    localIP = getLocalIP();
    currentPIN = generatePIN();
    await startServer();
    createTray();
    showPINWindow();

    // Hide from dock on macOS (run in background only)
    if (process.platform === "darwin") {
      app.dock?.hide();
    }
  });

  app.on("window-all-closed", () => {
    // Keep app running in tray
  });

  app.on("before-quit", () => {
    // Close firewall port on Windows before quitting
    closeFirewallPort(activePort);

    // Allow actual quit
    if (mainWindow) {
      mainWindow.removeAllListeners("close");
    }
  });
}
