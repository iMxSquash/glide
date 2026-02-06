# Glide

Remote PC control from iOS via local HTTPS server.

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

```bash
# 1. Install & build
npm install
npm run build:all

# 2. Test locally
npm run dev:server  # Opens popup with PIN + URL

# 3. On iPhone: https://192.168.x.x:3000
```

## Development

```bash
# Install dependencies
npm install

# Dev mode (client PWA standalone)
npm run dev:client  # http://localhost:4200

# Dev mode (server with PWA included)
npm run build:client  # Build PWA first
npm run dev:server    # Electron serves PWA at https://0.0.0.0:3000

# Production build
npm run build:all   # Build PWA + Server
npm run dist:win    # Create Windows .exe (includes PWA)
```

## Production Usage

1. **Build:** `npm run dist:win`
2. **Distribute:** `apps/server-electron/out/Glide Setup.exe`
3. **On PC:** Run `Glide.exe` → displays PIN + QR code + URL
4. **On iPhone:** Navigate to `https://192.168.x.x:3000/` (shown in PC popup)
5. **Enter PIN:** 6-digit code from PC
6. **Control:** Trackpad gestures + volume buttons

## Features

- ✅ 1-finger move = cursor
- ✅ 1-finger tap = left click
- ✅ 2-finger tap = right click
- ✅ Volume keys = PC volume control
- ✅ PWA served by Electron (no CORS)
- ✅ Local HTTPS with self-signed cert
- ✅ PIN authentication
- ✅ QR code auto-config

## Security

- Local network only (0.0.0.0:3000)
- PIN regenerated on each launch
- Self-signed TLS certificate
- No cloud services
- No data tracking

## Tech Stack

| Component | Technology                     |
| --------- | ------------------------------ |
| Server    | Electron + Express + Socket.io |
| Client    | React + Vite + PWA             |
| Inputs    | @nut-tree-fork/nut-js          |
| UI        | TailwindCSS                    |

## Troubleshooting

### PWA not loading
```bash
./test-setup.sh  # Verify configuration
npm run build:client  # Rebuild if needed
```

### Can't connect from iPhone
1. Check firewall allows port 3000
2. Verify same WiFi network
3. Accept certificate warning in Safari
