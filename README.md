<!-- prettier-ignore -->
<div align="center">

<img src="apps/client-pwa/public/icon-512.png" alt="" align="center" height="96" />

# Glide

*Turn your phone into a wireless trackpad for your PC — no cables, no port forwarding, no certificates to accept.*

[![Release](https://img.shields.io/github/v/release/iMxSquash/glide?style=flat-square)](https://github.com/iMxSquash/glide/releases/latest)
[![Build Status](https://img.shields.io/github/actions/workflow/status/iMxSquash/glide/release.yml?style=flat-square&label=Release)](https://github.com/iMxSquash/glide/actions/workflows/release.yml)
[![Node.js](https://img.shields.io/badge/Node.js->=24-3c873a?style=flat-square)](https://nodejs.org)
[![TypeScript](https://img.shields.io/badge/TypeScript-blue?style=flat-square&logo=typescript&logoColor=white)](https://www.typescriptlang.org)
[![Platform](https://img.shields.io/badge/platform-Windows%20%7C%20macOS-blue?style=flat-square)](#quick-start)

[Features](#features) • [Quick start](#quick-start) • [Architecture](#architecture) • [Development](#development) • [Troubleshooting](#troubleshooting)

</div>

Glide runs a small server on your PC and a Progressive Web App on your phone. The two connect directly to each other over **WebRTC**, negotiated through a lightweight signaling server, so your phone becomes a multitouch trackpad, keyboard and volume remote for your computer — over the same WiFi network, with nothing to install on the phone side.

> [!NOTE]
> The PC and the phone only use the signaling server to exchange a few KB of connection metadata (SDP/ICE). Once connected, trackpad input travels **directly between the two devices on your LAN** — it never goes through the internet.

## Features

- 🖱️ **Multitouch trackpad** — 1-finger move/tap for cursor and click, 2-finger tap for right-click, 2-finger drag to scroll, double-tap-and-hold to drag
- 🔊 **Volume control** — on-screen slider and mute, kept in sync with the PC's actual system volume
- ⌨️ **Remote keyboard** — type directly on the PC from your phone
- 📲 **Installable PWA** — add it to your home screen, no app store needed
- 🔒 **Peer-to-peer & encrypted** — PIN-protected, DTLS-encrypted WebRTC DataChannel; the signaling server never sees your input or your PIN
- ⚡ **Zero config** — scan a QR code, enter the PIN, done. Auto-reconnects after a WiFi drop or screen lock

## Quick start

### Download (recommended)

Grab the latest installer from the [Releases page](https://github.com/iMxSquash/glide/releases/latest):

- **Windows:** `Glide-Setup-*.exe`
- **macOS:** `Glide-*.dmg`

Run it, then on your phone scan the QR code shown in the app window and enter the PIN.

### Build from source

```bash
npm install
npm run build:all

npm run dist:win   # Windows .exe
npm run dist:mac   # macOS .dmg
```

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

The PC and the phone each open an *outbound* connection to the signaling server just long enough to exchange SDP/ICE, then talk directly to each other over a WebRTC DataChannel on the LAN. No inbound port to open, no firewall rule, no certificate to accept — the DataChannel is encrypted with DTLS natively, and the PWA is served over real HTTPS by Vercel.

> [!TIP]
> See [`TODO.md`](TODO.md) for planned v2 features (macOS support, out-of-LAN connectivity via STUN, etc.).

### Tech stack

| Component | Technology                                                            |
| --------- | ---------------------------------------------------------------------- |
| Server    | Electron + native WebRTC (hidden `BrowserWindow`) + socket.io-client   |
| Signaling | Node + Express + socket.io — deployed on Render                        |
| Client    | React + Vite + PWA — deployed on Vercel                                |
| Inputs    | [@nut-tree-fork/nut-js](https://github.com/nut-tree/nut.js)            |
| UI        | Tailwind CSS                                                           |
| Build     | Nx monorepo + electron-builder                                         |

## Usage

1. **Scan the QR code** shown in the PC popup with your phone's camera app — it opens the PWA (served over HTTPS) already pointed at the right PC session.
2. **Enter the PIN** displayed on the PC.
3. **Control the PC** with trackpad gestures, the on-screen keyboard, and the volume slider.
4. Optionally, add the PWA to your home screen from the browser menu for a native-app feel.

> [!IMPORTANT]
> Both devices must be on the **same WiFi network**. Some guest/hotel networks enable client isolation, which blocks the direct connection between devices.

> [!NOTE]
> The PWA requires a recent browser (Safari 16.4+, Chrome/Edge 111+, Firefox 128+) for both the trackpad's WebRTC/touch handling and the Tailwind CSS v4 build. Any iPhone still receiving iOS updates meets this.

## Development

```bash
npm install

npm run dev:server      # Electron server
npm run dev:client      # Client PWA — http://localhost:4200
npm run dev:signaling   # Signaling server — http://localhost:4000
```

A dev build of the server points at a local signaling server and PWA by default. A packaged release points at the deployed Render/Vercel instances instead — see `DEFAULT_SIGNALING_URL`/`DEFAULT_PWA_URL` in `apps/server-electron/src/main.ts` (overridable with the `GLIDE_SIGNALING_URL`/`GLIDE_PWA_URL` env vars).

```
glide/
├── apps/
│   ├── server-electron/   # Electron server (WebRTC host)
│   ├── client-pwa/        # React PWA (WebRTC client)
│   └── signaling/         # WebRTC signaling server (SDP/ICE relay)
├── scripts/                # Auto-start configuration
├── render.yaml              # Render deployment config (signaling)
└── vercel.json               # Vercel deployment config (PWA)
```

Auto-start on login:

```bash
npm run setup:autostart    # enable
npm run remove:autostart   # disable
```

## Security

- **Transport** — WebRTC DataChannel, DTLS-encrypted, negotiated peer-to-peer directly on the LAN
- **Signaling** — only relays SDP/ICE (a few KB at connect time); it never sees trackpad input, the PIN, or any control message
- **Auth** — 6-digit PIN, regenerated on every PC launch, rate-limited after 5 failed attempts
- **PWA** — served over real HTTPS, installable without any certificate warning
- **Privacy** — no cloud relay for input traffic, no tracking

## Troubleshooting

**Can't connect from the phone:**
1. Both devices are on the same WiFi network (and it doesn't isolate clients)
2. Glide is running on the PC and not paused (check the tray / menu bar)
3. The PIN matches the one currently shown on the PC — it's regenerated on every launch

> [!TIP]
> If the signaling server was idle, the first connection can take up to a minute (Render free-tier cold start). It retries automatically — no need to rescan.

**"Session not found" when scanning the QR code:** the PC's session id changes every time Glide restarts. If you scanned an old or screenshotted QR code, reopen the PC popup and scan the current one.

## Documentation

- [`RELEASES.md`](RELEASES.md) — how to cut a new GitHub release
- [`scripts/README.md`](scripts/README.md) — setup scripts documentation
- [`TODO.md`](TODO.md) — planned v2 features
