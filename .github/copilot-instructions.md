```markdown
# Glide — Instructions Copilot pour développement

## ⚠️ RÈGLES ABSOLUES (à respecter à la lettre)

1. **AUCUN fichier .md** à générer sauf demande explicite
2. **Commentaires MINIMAUX** : uniquement documentation anglaise `@param @returns`
3. **RGPD strict** : pas de tracking, pas de logs utilisateurs, pas de stockage données
4. **Sécurité** : PIN local uniquement, WSS local, jamais d'exposition publique
5. **Performance** : throttle 60fps, Socket.io compression, binary payloads
6. **Design System** : suivre scrupuleusement `DESIGN_SYSTEM.md` (couleurs, typos, espacements)
7. **Git commits** : atomiques, messages anglais "feat: add trackpad gestures"

---

## 🏗️ Architecture projet (Monorepo NX)

```
glide/
├── apps/
│   ├── server-electron/     # .exe Windows (GitHub Releases)
│   └── client-pwa/         # React TS PWA iPhone
├── libs/
│   ├── shared-types/       # TS interfaces
│   └── shared-ui/         # Components Tailwind réutilisables
├── DESIGN_SYSTEM.md              # Système design (OBLIGATOIRE)
└── nx.json
```

**Commandes initiales :**
```bash
npx create-nx-workspace@latest glide --preset=react-monorepo
cd glide
npm i -w=apps/server-electron electron socket.io robotjs electron-builder
npm i -w=apps/client-pwa react react-dom typescript @types/react
npm i -D tailwindcss postcss autoprefixer @tailwindcss/typography
```

---

## 🎯 Stack technique & justifications

| Composant | Technologie | Pourquoi |
|-----------|-------------|----------|
| **Serveur PC** | Electron + robotjs + Socket.io | Native Windows inputs, .exe auto-exécutable, latence <20ms |
| **Client mobile** | React TS + Vite + PWA | iOS Safari Pointer Events complets, installable écran d'accueil |
| **Communication** | Socket.io WSS | Bidirectionnel, auto-reconnect, compression gzip/brotli |
| **UI** | TailwindCSS + shadcn/ui | Design system précis, dark/light automatique, zéro bloat |
| **Sécurité** | PIN 6 chiffres + self-signed cert | Auth locale, chiffrement TLS local |

---

## 📱 CLIENT PWA (apps/client-pwa) — Spécifications précises

### Fonctionnalités obligatoires
```
Écran principal :
┌─────────────────────────────┐
│ [Logo Glide] [PIN: 123456] │  ← coin haut droit
├─────────────────────────────┤
│                             │
│        TRACKPAD             │  85% écran (200px mini)
│        (tactile)            │  Pointer Events multitouch
│                             │
├─────────────────────────────┤
│  Volume ▓▓▓░░░ 50%         │  ← Slider + boutons physiques
│  [−] [mute] [+]            │
└─────────────────────────────┘
```

### Trackpad gestures (EXACTS)
```typescript
// 1 doigt = move relatif
pointermove → socket.emit('mouseDelta', {x: deltaX*2, y: deltaY*2})

// Tap 1 doigt = left click
pointerdown (1 touch) → socket.emit('leftClick')

// Tap 2 doigts = right click  
pointerdown (2+ touches) → socket.emit('rightClick')

// Volume boutons physiques iOS
keydown (VolumeUp/Down) → socket.emit('volumeUp' | 'volumeDown')
```

### Implémentation minimale (src/App.tsx)
```typescript
// Surface trackpad 85% viewport height
// Slider volume 10% hauteur
// PIN modal au premier lancement
// Auto-connexion IP locale via mDNS
```

---

## 💻 SERVEUR ELECTRON (apps/server-electron)

### main.ts (Processus principal)
```typescript
// 1. Lance Socket.io WSS port 3000 (0.0.0.0)
// 2. robotjs listeners pour tous events
// 3. Génère PIN aléatoire 6 chiffres (affiché popup)
// 4. Auto-démarrage Windows (AppData)
// 5. Tray icon minimal (play/pause/quit)
```

### preload.ts (IPC sécurisé)
```typescript
// Expose UNIQUEMENT : mouseDelta, leftClick, rightClick, volumeUp/Down
// Jamais d'accès filesystem/réseau hors scope
```

### Package.json scripts
```json
{
  "build:win": "electron-builder --win",
  "dist": "npm run build && electron-builder --publish=github"
}
```

---

## 🔐 SÉCURITÉ (Non négociable)

```typescript
// 1. Self-signed certificate local (localhost:3000)
const cert = generateSelfSignedCert('0.0.0.0', 3000)

// 2. PIN 6 chiffres généré à chaque redémarrage
const pin = Math.floor(100000 + Math.random() * 900000).toString()

// 3. Auth middleware Socket.io
io.use((socket, next) => {
  if (socket.handshake.auth.pin === CURRENT_PIN) next()
  else next(new Error('Invalid PIN'))
})

// 4. Bind STRICT 0.0.0.0:3000 (LAN uniquement)
```

---

## 🎨 LANDING PAGE (à créer plus tard)

### Structure wireframe
```
Hero section :
┌─── Logo ──────────────────┐
│ Glide                     │  ← Manrope bold #6EE7B7
│ Contrôlez votre PC        │
│ depuis votre iPhone       │  ← Inter Regular
│                           │
│ [Download Windows] [iOS]  │  ← Buttons accent
└───────────────────────────┘

Features (3 cards) :
- Trackpad précis multitouch
- Volume boutons physiques  
- Sécurisé PIN local

Footer :
GitHub · Privacy · Contact
```

### Techno
```bash
npx create-next-app@latest glide-landing --ts --tailwind --eslint
npm i manrope@latest inter@latest
```

---

## 🚀 Déploiement GitHub

### Releases automatisées (.github/workflows)
```yaml
# Build .exe Windows à chaque tag vX.Y.Z
# Host PWA sur GitHub Pages (apps/client-pwa/dist)
# Changelog automatique depuis commits
```

### Structure releases
```
v1.0.0.exe          ← Electron app
client-pwa.zip     ← PWA build (hébergé GitHub Pages)
README.fr.md       ← Instructions françaises
README.en.md       ← Instructions anglaises
```

---

## ✅ Critères de validation

✅ **Fonctionne** : trackpad fluide <20ms, volume boutons iOS, clics précis  
✅ **Sécurisé** : PIN requis, WSS only, no cloud  
✅ **Design** : Dark mode exact DESIGN.md, zéro élément superflu  
✅ **PWA** : Installable iOS, offline splash, service worker  
✅ **Performance** : 60fps throttle, <50ms input lag WiFi  
✅ **Déployé** : .exe GitHub Releases + PWA GitHub Pages  

---

## 🚫 INTERDIT (arrêt immédiat si détecté)

- Animations décoratives
- Tracking analytics
- Cloud services (Vercel/Netlify)
- Fichiers .md non demandés
- Commentaires français ou verbeux
- Icônes non DESIGN_SYSTEM.md
- Couleurs hors palette
- Monospace UI (sauf code)
- Skeleton loaders
- Modals inutiles

**Copilot : suis ces instructions à la lettre. Demande clarification si doute.**