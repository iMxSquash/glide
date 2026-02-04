import { app, BrowserWindow, Tray, Menu, nativeImage } from "electron";
import { Server } from "socket.io";
import * as https from "https";
import * as fs from "fs";
import * as path from "path";
import { mouse, keyboard, Key } from "@nut-tree-fork/nut-js";

const PORT = 3000;
let mainWindow: BrowserWindow | null = null;
let tray: Tray | null = null;
let io: Server | null = null;
let currentPIN: string = "";
let isServerRunning = false;

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
function showPINWindow(): void {
  if (mainWindow) {
    mainWindow.show();
    mainWindow.focus();
    return;
  }

  mainWindow = new BrowserWindow({
    width: 400,
    height: 200,
    frame: false,
    resizable: false,
    alwaysOnTop: true,
    backgroundColor: "#0E0F12",
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
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
    }
    .container { text-align: center; }
    h1 {
      font-size: 64px;
      color: #6EE7B7;
      font-weight: bold;
      letter-spacing: 8px;
      margin: 10px 0;
    }
    p {
      color: #9A9DA3;
      font-size: 18px;
    }
  </style>
</head>
<body>
  <div class="container">
    <p>Your PIN</p>
    <h1>${currentPIN}</h1>
  </div>
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
  currentPIN = generatePIN();
  startServer();
  createTray();
  showPINWindow();
});

app.on("window-all-closed", () => {
  // Keep app running in tray
});
