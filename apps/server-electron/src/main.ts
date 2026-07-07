import { app, BrowserWindow, Tray, Menu, nativeImage } from "electron";
import * as fs from "fs";
import * as path from "path";
import * as QRCode from "qrcode";
import {
  startWebRtcHost,
  getSessionId,
  setAccepting,
  isAcceptingConnections,
  onPeerStateChange,
} from "./webrtcSession";

// En dev (app.isPackaged === false), on pointe sur les instances locales.
// Une fois packagé (release .exe/.dmg), personne ne va définir
// GLIDE_SIGNALING_URL/GLIDE_PWA_URL à la main avant de lancer l'installeur :
// le binaire distribué doit fonctionner tel quel, donc il pointe directement
// sur le déploiement de production (étape E). Les deux variables d'env
// restent un override possible (ex. pointer un build packagé vers un
// environnement de test).
const DEFAULT_SIGNALING_URL = app.isPackaged
  ? "https://glide-signaling.onrender.com"
  : "http://localhost:4000";
const DEFAULT_PWA_URL = app.isPackaged
  ? "https://glide-lyart.vercel.app"
  : "http://localhost:4200";

let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let updateTrayMenu: (() => void) | null = null;
let currentPIN: string = "";
let isPeerConnected = false;

// Une seule instance du serveur à la fois (sinon deux process se battent pour
// la même session de signaling et l'un des deux échoue silencieusement).
const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
}

/**
 * @returns {string} Random 6-digit PIN
 */
function generatePIN(): string {
  return Math.floor(100000 + Math.random() * 900000).toString();
}

/**
 * Reflects the phone's connection state (0 ou 1 appareil, session WebRTC
 * unique en v1) dans le tooltip/menu du tray et, si ouverte, la fenêtre PIN.
 * @param {boolean} connected Whether a phone is currently authenticated
 */
function setPeerConnectedUI(connected: boolean): void {
  isPeerConnected = connected;
  const label = connected ? "1 appareil connecté" : "Aucun appareil connecté";

  tray?.setToolTip(`Glide - Remote PC Control${connected ? ` (${label})` : ""}`);
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
    const clientLabel = isPeerConnected ? "1 appareil connecté" : "Aucun appareil connecté";

    const contextMenu = Menu.buildFromTemplate([
      {
        label: `PIN: ${currentPIN}`,
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
        label: isAcceptingConnections() ? "Pause Server" : "Resume Server",
        click: () => {
          setAccepting(!isAcceptingConnections());
          updateTrayMenu?.();
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

  // Le lien encode uniquement l'id de session (pas le PIN) : la PWA le
  // récupère via le hash au chargement pour rejoindre la bonne room de
  // signaling, puis demande le PIN à l'utilisateur pour l'auth WebRTC.
  const pwaUrl = process.env.GLIDE_PWA_URL || DEFAULT_PWA_URL;
  const qrUrl = `${pwaUrl}/#s=${getSessionId()}`;
  const qrCodeDataURL = await QRCode.toDataURL(qrUrl, {
    width: 250,
    color: { dark: "#6EE7B7", light: "#0E0F12" },
  });

  const clientLabel = isPeerConnected ? "1 appareil connecté" : "Aucun appareil connecté";

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
    .logo-row {
      display: flex;
      align-items: center;
      gap: 8px;
      margin-bottom: 16px;
    }
    .logo-row svg {
      width: 22px;
      height: 22px;
      flex-shrink: 0;
      fill: #6EE7B7;
    }
    h1 {
      color: #6EE7B7;
      font-size: 20px;
      font-weight: 600;
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
    .session-code {
      color: #6A6D73;
      font-size: 11px;
      font-family: 'SFMono-Regular', Consolas, monospace;
      margin-top: 16px;
      word-break: break-all;
      user-select: all;
    }
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
      <div class="logo-row">
        <svg viewBox="0 0 633 502" xmlns="http://www.w3.org/2000/svg">
          <path fill-rule="evenodd" clip-rule="evenodd" d="M469.635 1.62489C454.32 5.09228 443.333 11.3734 429.348 24.6589C410.259 42.7918 397.347 63.2079 365.499 125.624C330.074 195.056 322.544 210.409 308.448 215.721C305.682 216.764 299.687 217.557 294.105 212.656C286.882 206.315 281.345 196.034 269.358 166.692C264.755 155.428 258.488 141.512 255.43 135.767C237.26 101.627 206.97 89.3228 177.185 103.981C157.09 113.871 146.073 129.421 127.258 174.462C112.037 210.897 101.28 225.244 81.9111 234.949C69.6871 241.076 58.3126 243.273 35.6758 243.888C17.2864 244.386 15.2971 244.789 9.55197 249.172C-4.8447 260.153 -2.59716 282.02 13.7977 290.499C20.5152 293.973 51.6379 294.018 69.2242 290.579C98.6639 284.823 117.219 275.084 135.338 255.878C150.039 240.294 158.334 226.246 173.203 191.754C188.711 155.784 194.365 147.102 202.294 147.102C210.792 147.102 213.946 160.516 224.003 184.666C245.072 235.259 252.452 248.919 272.496 259.722C284.778 266.341 296.648 266.28 301.514 266.28C307.281 266.28 318.528 264.991 329.237 259.722C343.11 252.895 357.672 238.251 371.57 217.15C376.625 209.477 392.32 180.36 406.449 152.445C420.58 124.529 437.057 94.2791 443.066 85.2197C460.991 58.1948 476.559 46.4818 490.053 49.8691C501.425 52.7239 499.99 62.8909 480.976 114.156C473.711 133.745 457.121 179.006 444.111 214.735L420.456 279.694L393.844 289.681C289.394 328.882 228.806 367.134 210.669 405.33C205.613 415.982 203.853 423.646 203.486 435.614C203.256 443.09 205.645 455.19 209.921 463.209C222.822 487.406 250.413 501.498 284.891 501.498C336.396 501.498 380.381 473.186 412.985 419.043C425.195 398.77 432.897 382.339 445.714 349.233C458.563 316.04 453.521 319.933 496.557 309.987C533.271 301.503 560.882 296.953 590.596 294.493C619.553 292.096 624.846 289.963 630.513 278.403C636.958 265.262 629.275 249.282 614.562 245.218C599.777 241.136 519.738 252.135 484.929 263.032C482.076 263.926 479.401 264.315 478.983 263.896C478.276 263.189 497.584 209.527 525.813 133.745C543.326 86.7317 546.304 70.3427 546.304 58.7524C546.304 47.162 544.824 40.1935 540.584 32.1635C527.918 8.16783 497.866 -4.76671 469.635 1.62489ZM395.415 344.335C394.813 346.048 390.113 356.411 384.968 367.362C373.628 391.502 356.78 416.566 344.12 428.138C325.689 444.982 298.178 455.309 279.151 452.522C268.019 450.893 256.65 445.623 254.137 440.929C245.884 425.508 275.622 397.372 327.994 371.05C347.965 361.011 392.343 341.347 395.228 341.258C395.931 341.236 396.015 342.622 395.415 344.335Z"/>
        </svg>
        <h1>Glide Server</h1>
      </div>
      <div class="pin">${currentPIN}</div>
      <p class="info" id="clientCount" style="font-size: 12px;">${clientLabel}</p>
      <ol class="steps">
        <li>Scanne le QR code avec l'appareil photo de ton téléphone (ça ouvre directement la PWA)</li>
        <li>Entre le PIN affiché ci-dessus quand la PWA le demande</li>
      </ol>
      <p class="session-code">Code de session (saisie manuelle) : ${getSessionId()}</p>
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
    currentPIN = generatePIN();

    startWebRtcHost({
      signalingUrl: process.env.GLIDE_SIGNALING_URL || DEFAULT_SIGNALING_URL,
      getCurrentPin: () => currentPIN,
    });
    onPeerStateChange(setPeerConnectedUI);

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
    if (mainWindow) {
      mainWindow.removeAllListeners("close");
    }
  });
}
