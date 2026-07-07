# Glide

Remote PC control from iPhone/Android over a WebRTC peer-to-peer connection.

## Architecture

```
              ┌───────────┐  wss out (signaling
              │ Signaling │  only: SDP/ICE, a few
              │ (Render)  │  KB at connect time)
              └─────▲─────┘
     wss out        │
┌──────────┐        │              ┌──────────┐
│  iPhone/ │────────┘              │ Electron │
│ Android  │◄═════════════════════►│    PC    │
│ (PWA on  │  WebRTC DataChannel   │ (Server) │
│  Vercel) │  direct on the LAN    └──────────┘
└──────────┘
```

**Key design:** the PC and the phone each open an *outbound* connection to the signaling server just to exchange SDP/ICE, then talk directly to each other over the WebRTC DataChannel on the LAN. No inbound port to open, no firewall rule, no certificate to accept — the DataChannel is encrypted with DTLS natively, and the PWA is served over real HTTPS by Vercel. See [`TODO.md`](TODO.md) for the full architecture rationale (why WebRTC over a relay, why no STUN yet, etc).

## Quick Start

### Download (Recommended)

**Latest release:** [Download from GitHub Releases](https://github.com/imxsquash/glide/releases/latest)

- **Windows:** `Glide-Setup-*.exe`
- **macOS:** `Glide-*.dmg`

### Build from source

```bash
# 1. Install & build
npm install
npm run build:all

# 2. Create distributable
npm run dist:win  # Windows .exe
npm run dist:mac  # macOS .dmg

# 3. Run the app
# Windows: Glide Setup.exe
# macOS: Glide.dmg

# 4. On your phone: scan the QR code shown in the app window
```

## Development

```bash
# Install dependencies
npm install

# Dev mode
npm run dev:server      # Electron server
npm run dev:client      # Client PWA standalone — http://localhost:4200
npm run dev:signaling   # Signaling server standalone — http://localhost:4000

# Production build
npm run build:all       # Build PWA + Server
npm run dist:win        # Windows .exe
npm run dist:mac        # macOS .dmg
```

By default, a dev build of the server points at a local signaling server (`http://localhost:4000`) and expects the PWA on `http://localhost:4200`. A packaged release points at the deployed signaling server and PWA instead — see `DEFAULT_SIGNALING_URL`/`DEFAULT_PWA_URL` in `apps/server-electron/src/main.ts` (overridable with the `GLIDE_SIGNALING_URL`/`GLIDE_PWA_URL` env vars either way).

## Production Usage

### Windows
1. **Build:** `npm run dist:win`
2. **Locate:** `apps/server-electron/out/Glide Setup.exe`
3. **Install & Run:** Double-click the installer
4. **Result:**
   - ✅ Shows popup with PIN + QR code
   - ✅ Runs in system tray

### macOS
1. **Build:** `npm run dist:mac`
2. **Locate:** `apps/server-electron/out/Glide-1.0.0-arm64.dmg`
3. **Install & Run:** Double-click and drag to Applications
4. **Result:**
   - ✅ Shows popup with PIN + QR code
   - ✅ Runs in menu bar

### iPhone / Android
1. **Scan the QR code** shown in the PC popup with the camera app — it opens the PWA (served over HTTPS by Vercel) already pointed at the right PC session.
2. **Enter PIN:** 6-digit code from the PC popup.
3. **Control:** Trackpad gestures + on-screen volume slider.
4. **Optional — install as an app:** browser menu → **Add to Home screen**. Real HTTPS means no certificate to re-accept, even for the installed app.

> Both devices must be on the **same WiFi network** — the trackpad traffic itself stays on the LAN (it never goes through the signaling server or the internet). A WiFi with client isolation (some guest networks, hotels) will block the direct connection.

## Auto-start (Optional)

```bash
# Enable app to start on login
npm run setup:autostart

# Disable auto-start
npm run remove:autostart
```

## Features

- ✅ **Trackpad gestures:**
  - 1-finger move = cursor
  - 1-finger tap = left click
  - 2-finger tap = right click
  - 2-finger drag = scroll
  - Double-tap-and-hold = drag
- ✅ **Volume control:** on-screen slider + mute, synced with the PC's real volume (physical volume buttons can't be intercepted by a browser/PWA on iOS/Android)
- ✅ **On-screen keyboard:** types directly on the PC
- ✅ **PWA:** installable on iPhone/Android, works offline once connected
- ✅ **Secure:** PIN auth over the WebRTC control channel (the signaling server never sees it), DTLS-encrypted DataChannel, real HTTPS on the PWA
- ✅ **Zero config:** QR code auto-setup, auto-reconnect after WiFi drop or screen lock

## Security

- **Transport:** WebRTC DataChannel, DTLS-encrypted, negotiated peer-to-peer directly on the LAN
- **Signaling:** only relays SDP/ICE (a few KB at connect time) between the PC and the phone — it never sees trackpad input, the PIN, or any control message
- **Auth:** 6-digit PIN, regenerated on each PC launch, rate-limited (5 wrong attempts blocks for 5 minutes)
- **PWA:** served over real HTTPS (Vercel), installable without any certificate warning
- **Privacy:** no cloud relay for input traffic, no tracking, no logs beyond what's needed for the signaling handshake

## Tech Stack

| Component | Technology                                  |
| --------- | -------------------------------------------- |
| Server    | Electron + native WebRTC (hidden `BrowserWindow`) + socket.io-client |
| Signaling | Node + Express + socket.io (deployed on Render) |
| Client    | React + Vite + PWA (deployed on Vercel)      |
| Inputs    | @nut-tree-fork/nut-js                        |
| UI        | TailwindCSS                                  |
| Build     | NX monorepo + electron-builder               |

## Troubleshooting

### PWA not loading / build issues
```bash
npm run build:client  # Rebuild if needed
```

### Can't connect from the phone
1. ✅ Both devices on the same WiFi network (and it doesn't isolate clients — some guest/hotel networks do)
2. ✅ Glide is running on the PC (check the system tray / menu bar) and not paused
3. ✅ PIN matches the one currently shown on the PC (it's regenerated on every launch)
4. ✅ If the signaling server was idle, the first connection attempt can take up to ~1 minute (Render free tier cold start) — it retries automatically, no need to rescan

### "Session not found" when scanning the QR code
- The PC's session id changes every time Glide restarts. If you rescanned an old QR code (e.g. a screenshot), open the PC popup again and rescan the current one.

## Project Structure

```
glide/
├── apps/
│   ├── server-electron/    # Electron server (WebRTC host)
│   ├── client-pwa/         # React PWA (WebRTC client)
│   └── signaling/          # WebRTC signaling server (SDP/ICE relay)
├── scripts/
│   └── setup-autostart.cjs # Auto-start configuration
├── dist/
│   └── apps/client-pwa/    # Built PWA
├── render.yaml              # Render deployment config (signaling)
├── vercel.json               # Vercel deployment config (PWA)
└── README.md
```

## Documentation

- [RELEASES.md](RELEASES.md) - How to create GitHub releases
- [scripts/README.md](scripts/README.md) - Setup scripts documentation
- [TODO.md](TODO.md) - Full implementation history and architecture rationale

## Contributing

1. Fork the project
2. Create feature branch: `git checkout -b feature/amazing`
3. Commit changes: `git commit -m 'Add amazing feature'`
4. Push branch: `git push origin feature/amazing`
5. Open Pull Request

## License

MIT
