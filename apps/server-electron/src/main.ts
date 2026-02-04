import { app, BrowserWindow, Tray, Menu, nativeImage } from "electron";
import { Server } from "socket.io";
import * as https from "https";
import * as fs from "fs";
import * as path from "path";
import * as os from "os";
import * as QRCode from "qrcode";
import { mouse, keyboard, Key } from "@nut-tree-fork/nut-js";

const PORT = 3000;
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let io: Server | null = null;
let currentPIN: string = "";
let localIP: string = "";
let isServerRunning = false;

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

/**
 * @returns {{ key: string; cert: string }} Self-signed certificate
 */
function generateSelfSignedCert(): { key: string; cert: string } {
  const certPath = path.join(app.getPath("userData"), "cert.pem");
  const keyPath = path.join(app.getPath("userData"), "key.pem");

  if (!fs.existsSync(certPath) || !fs.existsSync(keyPath)) {
    const { execSync } = require("child_process");
    execSync(
      `openssl req -x509 -newkey rsa:4096 -keyout "${keyPath}" -out "${certPath}" -days 365 -nodes -subj "/CN=localhost"`,
    );
  }

  return {
    key: fs.readFileSync(keyPath, "utf8"),
    cert: fs.readFileSync(certPath, "utf8"),
  };
}

/**
 * Start Socket.io WSS server
 */
function startServer(): void {
  const cert = generateSelfSignedCert();
  const httpsServer = https.createServer(cert);

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

    socket.on("mouseDelta", async (data: { x: number; y: number }) => {
      const pos = await mouse.getPosition();
      await mouse.setPosition({ x: pos.x + data.x, y: pos.y + data.y });
    });

    socket.on("leftClick", async () => {
      await mouse.leftClick();
    });

    socket.on("rightClick", async () => {
      await mouse.rightClick();
    });

    socket.on("volumeUp", async () => {
      await keyboard.type(Key.AudioVolUp);
    });

    socket.on("volumeDown", async () => {
      await keyboard.type(Key.AudioVolDown);
    });

    socket.on("disconnect", () => {
      console.log("Client disconnected");
    });
  });

  httpsServer.listen(PORT, "0.0.0.0", () => {
    console.log(`Glide server running on port ${PORT}`);
    isServerRunning = true;
  });
}

/**
 * Create tray icon
 */
function createTray(): void {
  const icon = nativeImage.createEmpty();
  tray = new Tray(icon);

  const updateMenu = () => {
    const contextMenu = Menu.buildFromTemplate([
      {
        label: `PIN: ${currentPIN}`,
        enabled: false,
      },
      { type: "separator" },
      {
        label: "Show PIN",
        click: () => {
          showPINWindow();
        },
      },
      {
        label: isServerRunning ? "Pause" : "Resume",
        click: () => {
          isServerRunning = !isServerRunning;
          updateMenu();
        },
      },
      {
        label: "Quit",
        click: () => {
          app.quit();
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
    <p class="info">${localIP}:3000</p>
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
});

app.on("window-all-closed", () => {
  // Keep app running in tray
});
