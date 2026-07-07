# Glide

Remote PC control from iOS via local HTTPS server.

> ⚠️ **Branch `feat/webrtc-signaling` is mid-migration.** The server and PWA
> now negotiate a direct WebRTC P2P connection through a signaling server
> instead of running a local HTTPS/Socket.io server (no more firewall rules,
> self-signed certificate, or `https://IP:3000`). This works end-to-end
> locally (verified), but nothing is deployed yet: the signaling server needs
> a public host (Render) and the PWA needs to be served over real HTTPS
> (Vercel) — see `TODO.md` étape E for the plan. Everything below describes
> the old LAN direct mode and will be rewritten once the migration is
> deployed and validated.

## Architecture

```
┌─────────────┐     WSS/HTTPS     ┌──────────────┐
│   iPhone    │ ◄─────────────────► │ Electron PC  │
│   (PWA)     │   192.168.x.x:3000  │   (Server)   │
└─────────────┘                     └──────────────┘
       ↑                                    │
       └────────── Served by ───────────────┘
```

**Key design:** PWA served by Electron server = same origin = no CORS issues.

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

# 4. On iPhone: https://192.168.x.x:3000
```

## Development

```bash
# Install dependencies
npm install

# Dev mode
npm run dev:server

# Dev mode (client PWA standalone)
npm run dev:client    # http://localhost:4200

# Production build
npm run build:all     # Build PWA + Server
npm run dist:win      # Windows .exe
npm run dist:mac      # macOS .dmg
```

## Production Usage

### Windows
1. **Build:** `npm run dist:win`
2. **Locate:** `apps/server-electron/out/Glide Setup.exe`
3. **Install & Run:** Double-click the installer
4. **Result:** 
   - ✅ Opens firewall port 3000 automatically
   - ✅ Shows popup with PIN + URL
   - ✅ Runs in system tray
   - ✅ Closes firewall on quit

### macOS
1. **Build:** `npm run dist:mac`
2. **Locate:** `apps/server-electron/out/Glide-1.0.0-arm64.dmg`
3. **Install & Run:** Double-click and drag to Applications
4. **Result:**
   - ✅ Shows popup with PIN + URL
   - ✅ Runs in menu bar
   - ✅ macOS handles firewall automatically

### iPhone
1. **Open Safari:** Navigate to `https://192.168.x.x:3000/` (from PC popup) — use Safari itself, not an already-installed home screen app
2. **Accept certificate:** Trust the self-signed certificate
3. **Enter PIN:** 6-digit code from PC
4. **Control:** Trackpad gestures + on-screen volume slider

> ⚠️ **Installed PWA + certificate:** once the app is added to the home screen, it runs in standalone mode and iOS won't show the "trust this certificate" prompt if the cert ever changes (new PC, new IP, cert renewed). If the installed app can't connect, open the same `https://` URL directly in Safari first, accept the certificate there, then reopen the installed app.

### Android
1. **Open Chrome:** Navigate to `https://192.168.x.x:3000/` (from PC popup or by scanning the QR code)
2. **Accept certificate:** Chrome shows "Your connection is not private" — tap **Advanced** → **Proceed to `<IP>` (unsafe)** to trust the self-signed certificate
3. **Enter PIN:** 6-digit code from PC
4. **Control:** Trackpad gestures + on-screen volume slider
5. **Optional — install as an app:** Chrome menu (⋮) → **Add to Home screen** → **Install**. As with iOS, if the installed app ever fails to connect (new PC, new IP, renewed cert), open the same `https://` URL in Chrome directly first to re-accept the certificate, then reopen the installed app.

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
- ✅ **Volume control:** on-screen slider + mute (physical volume buttons can't be intercepted by a browser/PWA on iOS/Android)
- ✅ **PWA:** Installable on iPhone, works offline
- ✅ **Auto firewall:** Opens/closes port automatically
- ✅ **Secure:** PIN auth + self-signed TLS with IP SAN
- ✅ **Zero config:** QR code auto-setup

## Security

- **Network:** Local only (0.0.0.0:3000), not exposed to internet
- **Auth:** 6-digit PIN, regenerated on each launch
- **TLS:** Self-signed certificate with IP in Subject Alternative Names
- **Firewall:** Automatic management on Windows
- **Privacy:** No cloud, no tracking, no logs

## Tech Stack

| Component | Technology                     |
| --------- | ------------------------------ |
| Server    | Electron + Express + Socket.io |
| Client    | React + Vite + PWA             |
| Inputs    | @nut-tree-fork/nut-js          |
| UI        | TailwindCSS                    |
| Build     | NX monorepo + electron-builder |

## Troubleshooting

### PWA not loading
```bash
./test-setup.sh       # Verify configuration
npm run build:client  # Rebuild if needed
```

### SSL Certificate Error
- iPhone Safari → Accept self-signed certificate
- Certificate includes local IP in SAN for compatibility
- Certificate is persisted across server restarts (only regenerated if the PC's local IP changes)

### Can't connect from iPhone
1. ✅ PC firewall allows port 3000 (auto-managed by app)
2. ✅ Both devices on same WiFi network
3. ✅ Accept certificate warning in Safari first time
4. ✅ If using the installed home screen app, try opening the `https://` URL in Safari directly first (see note above)

### Windows firewall not opening
- Run app as Administrator first time

## Project Structure

```
glide/
├── apps/
│   ├── server-electron/    # Electron server
│   ├── client-pwa/         # React PWA
│   └── signaling/          # WebRTC signaling server (SDP/ICE relay)
├── scripts/
│   └── setup-autostart.cjs # Auto-start configuration
├── dist/
│   └── apps/client-pwa/    # Built PWA
└── README.md
```

## Documentation

- [PRODUCTION.md](PRODUCTION.md) - Detailed production setup guide
- [CHANGELOG.md](CHANGELOG.md) - Changes and improvements log
- [RELEASES.md](RELEASES.md) - How to create GitHub releases
- [scripts/README.md](scripts/README.md) - Setup scripts documentation

## Contributing

1. Fork the project
2. Create feature branch: `git checkout -b feature/amazing`
3. Commit changes: `git commit -m 'Add amazing feature'`
4. Push branch: `git push origin feature/amazing`
5. Open Pull Request

## License

MIT
