# TODO — Finalisation Glide v1 (Windows + iOS/Android)

Objectif v1 : téléphone (iPhone/Android) = souris à distance fiable pour un PC Windows sur le même WiFi. macOS en v2.

Les bugs constatés (souris qui saute, clics qui ne partent pas, volume aléatoire) ont des causes précises identifiées dans le code — elles sont référencées ci-dessous avec `fichier:ligne`.

---

## 🔴 P0 — Bugs bloquants (les problèmes que tu constates)

### 1. Le clic ne fonctionne pas / pas toujours ✅ Fait
- [x] **Bug de double émission de clic** — `apps/client-pwa/src/App.tsx:176-195` : lors d'un tap à 2 doigts, le `pointerup` du 1er doigt émet `rightClick` (size===2), puis le `pointerup` du 2e doigt voit size===1 et émet **aussi** `leftClick`. Fix : après avoir émis un clic, ignorer les pointerup restants du même geste (flag `gestureHandledRef` remis à zéro quand `pointersRef.size === 0`).
- [x] **Seuil de mouvement trop strict qui annule les taps** — `App.tsx:168` : `hasMovedRef` passe à `true` dès 2px de delta. Un doigt qui tape bouge naturellement de 3-10px → le tap est interprété comme un mouvement et le clic est annulé. Fix : mesurer la distance **cumulée depuis le pointerdown** (pas le delta par event) et utiliser un seuil ~10-15px.
- [x] **`pointerDownTimeRef` non fiable pour le tap 2 doigts** — `App.tsx:151-158` : le timestamp n'est posé que pour le 1er doigt. Si le 2e doigt arrive tard, `tapDuration` est faussé. Fix : timestamp du début du geste + timestamps par pointeur.
- [x] Ajouter le **retour haptique** (`navigator.vibrate(10)` — Android seulement) et un feedback visuel au clic pour que l'utilisateur sache que le tap est parti.

### 2. La souris est buggée / saccadée ✅ Fait
- [x] **Flood du socket + aller-retour async par event** — `App.tsx:161-174` émet un `mouseDelta` par `pointermove` (60-120/s), et côté serveur `apps/server-electron/src/main.ts:183-186` chaque delta fait un `await mouse.getPosition()` **puis** `await mouse.setPosition()`. Les events s'empilent, s'exécutent dans le désordre → curseur qui rame et saute. Fix :
  - Client : accumuler les deltas et émettre à cadence fixe via `requestAnimationFrame` (~60 Hz max).
  - Serveur : accumuler les deltas reçus et n'appliquer qu'un seul `setPosition` par tick (boucle ~120 Hz), au lieu d'un `getPosition` par message.
- [x] **Perte des petits mouvements** — `App.tsx:168` : les deltas < 2px sont jetés → impossible de faire un mouvement précis (le curseur "colle"). Fix : tout envoyer une fois l'accumulation en place, le seuil ne doit servir qu'à la détection tap-vs-move.
- [x] **Sensibilité codée en dur** (`* 2` à `App.tsx:165-166`) : ajouter un réglage de sensibilité (slider dans un panneau settings, persisté en `localStorage`) + courbe d'accélération (mouvement rapide = multiplicateur plus fort).
- [x] Utiliser `e.movementX/Y` n'est pas dispo sur touch — garder le calcul par delta mais avec `getCoalescedEvents()` quand disponible pour ne rien perdre entre deux frames.

### 3. Le volume via boutons physiques ne marche pas (ou par hasard) ✅ Fait
- [x] **Accepter la réalité : c'est impossible en PWA.** `App.tsx:29-42` écoute `keydown` avec `e.key === "VolumeUp"` — les boutons volume matériels **ne génèrent jamais d'événement clavier** dans Safari iOS ni Chrome Android ; ils contrôlent le volume média du téléphone, point. Quand "ça marche parfois", c'est un comportement non spécifié. Décision prise : **Option A** — listener mort supprimé, boutons volume à l'écran + slider (Option B/Capacitor reste en v2).
- [x] **Synchroniser le volume affiché avec le volume réel du PC** — `App.tsx:19` : `volume` démarre à 50 et n'est qu'un compteur local, faux dès le départ. Fix : le serveur lit le volume réel via la lib `loudness` npm et l'envoie au client à la connexion + après chaque changement (event `volumeState`).
- [x] **Le slider volume ne fait rien** — `App.tsx:333-342` : le `onChange` met à jour le state local mais n'émet **aucun événement** au serveur. Fix : émet `setVolume(value)` (debounced) implémenté côté serveur via `loudness`.
- [x] Ajouter un bouton **Mute** (implémenté via `loudness.setMuted`, cohérent avec le reste du volume).

### 4. Connexion fragile (cause probable de "beuggé côté téléphone") ✅ Fait
- [x] **Certificat auto-signé régénéré à chaque lancement** — `main.ts:117-137` : `selfsigned.generate()` tourne à chaque démarrage → le téléphone doit ré-accepter le certificat à chaque fois, et les connexions WSS échouent silencieusement entre-temps. Fix : généré une fois, persisté dans `app.getPath("userData")` (`cert.pem`/`key.pem`/`cert-meta.json`), régénéré seulement si l'IP locale a changé.
- [x] **PWA installée sur iOS + certificat auto-signé = WSS bloqué.** Décision prise pour la v1 : documenter "utiliser Safari, pas l'app installée" (README mis à jour) + détection runtime du mode standalone qui ajoute cette astuce au message d'erreur de connexion.
- [x] **Aucune gestion de déconnexion côté client** — `App.tsx` n'écoute ni `disconnect` ni `reconnect` : si le WiFi coupe ou l'écran se verrouille, l'UI reste "connectée" mais plus rien ne marche. Fix : bandeau "Reconnexion…" sur `disconnect`, reconnexion auto (socket.io), retour au modal PIN après échec de `reconnect_failed`.
- [x] **Empêcher la mise en veille de l'écran** : **Wake Lock API** (`navigator.wakeLock.request("screen")`) ajoutée quand connecté + re-demandée sur `visibilitychange`.
- [x] **Google Fonts bloque le chargement sans internet** — `apps/client-pwa/index.html:9-12` : fix appliqué en tombant sur `system-ui` (Google Fonts retiré).
- [x] **Mémoriser la dernière connexion** (IP + PIN en `localStorage`) → reconnexion automatique à l'ouverture.
- [x] `rejectUnauthorized: false` (`App.tsx:61`) supprimé (option Node inutile côté navigateur).

---

## 🟠 P1 — Indispensable pour une v1 complète

### Serveur Windows ✅ Fait
- [x] **Icône de tray invisible** — `main.ts:222` : `nativeImage.createEmpty()` → l'icône dans la barre des tâches Windows est **invisible**, l'app semble fantôme. Vraie icône générée (curseur mint sur fond sombre) et chargée depuis `assets/tray-icon.png` (+ `@2x` pour l'écran HiDPI).
- [x] **Assets manquants pour le build** : `apps/server-electron/assets/icon.ico` est référencé par electron-builder (`package.json` → `win.icon`) mais le dossier `assets/` **n'existe pas**. Idem pour la PWA : `icon-192.png`, `icon-512.png`, `favicon.ico`, `apple-touch-icon.png` référencés dans `vite.config.ts:15,24-35` mais **aucun dossier `public/` n'existe** → PWA non installable proprement (icône générique). Icônes générées depuis une source SVG (toutes tailles) et placées dans `apps/server-electron/assets/` et `apps/client-pwa/public/`.
- [x] **"Pause Server" ne fait rien** — `main.ts:252-257` : le menu tray inverse juste un booléen. Implémenté : `setServerRunning()` refuse les nouvelles connexions (middleware `io.use`) et déconnecte tous les clients actifs (`io.disconnectSockets(true)`).
- [x] **Code mort à supprimer** — `main.ts:45-60` : `generateSelfSignedCert()` (openssl) n'est jamais appelée et ne marcherait pas sur Windows. (Supprimé lors du fix P0.4 sur la persistance du certificat.)
- [x] **Single instance lock** : `app.requestSingleInstanceLock()` pour éviter deux serveurs qui se battent sur le port 3000.
- [x] **Gérer le port déjà occupé** : si 3000 est pris, le serveur essaie 3001, 3002... (jusqu'à 10 tentatives) et affiche le port réel dans la fenêtre PIN/tray/QR code. Le client accepte désormais `ip` ou `ip:port` (saisie manuelle, QR, dernière connexion mémorisée) au lieu de coder `:3000` en dur.
- [x] **Détecter le changement d'IP / multi-interfaces** — `main.ts:23-33` : `getLocalIP()` filtre maintenant les interfaces virtuelles connues (VirtualBox, VMware, vEthernet, Docker, WSL, Tailscale, ZeroTier, VPN...) et liste les autres IP candidates dans la fenêtre PIN si plusieurs existent.
- [x] **Rate-limit sur l'auth PIN** (`main.ts:171-178`) : une IP est bloquée 5 minutes après 5 PIN faux.
- [x] Événement `connected`/`clientCount` vers le tray + fenêtre PIN ("N appareil(s) connecté(s)").

### Client PWA ✅ Fait
- [x] **Scroll à 2 doigts** — drag à 2 doigts accumule un delta (rAF, comme `mouseDelta`) envoyé via l'event `scroll` ; le serveur convertit les pixels accumulés en "steps" et appelle `mouse.scrollUp/Down/Left/Right`.
- [x] **Drag & drop** : double-tap-and-hold (2e tap posé < 300ms après le 1er, à moins de 30px, tenu 150ms sans bouger) émet `mouseDown` (`mouse.pressButton`), le déplacement réutilise le flux `mouseDelta` existant, le relâchement émet `mouseUp` (`mouse.releaseButton`). Sécurité : relâchement forcé du bouton à la déconnexion socket.
- [x] **Clavier texte** : bouton clavier dans le header ouvre un overlay avec un input ; les caractères tapés/effacés sont diffés et envoyés en direct (`typeText`/`keyPress`), le serveur utilise `keyboard.type`.
- [x] **Écran de connexion : parcours QR d'abord** : l'écran par défaut propose "Scan QR Code" en CTA principal, la saisie manuelle IP/PIN passe derrière un lien "Enter IP and PIN manually".
- [x] Gérer l'erreur "Invalid PIN" distinctement de "serveur injoignable"/rate-limit/pause : bandeau d'erreur inline dans le modal (plus d'`alert()`) avec un message dédié par cas.
- [x] Bouton **Disconnect** dans le panneau settings : ferme la socket, efface la dernière connexion mémorisée, retour au modal PIN (écran QR-first).
- [x] `overscroll-behavior: none` + `height: 100%` sur `html`/`body`/`#root` pour bloquer le pull-to-refresh/swipe-back iOS.

### Sécurité ✅ Fait
- [x] **HTTPS auto-signé vs HTTP+WS local : on garde HTTPS.** Le service worker de la PWA (précache, installabilité) exige un contexte sécurisé (HTTPS ou localhost) — passer en HTTP simple casserait la PWA elle-même, pas seulement le chiffrement. La friction certificat (P0.4) est déjà traitée : cert persisté, régénéré seulement si l'IP change, README documente le flow d'acceptation Safari.
- [x] Ne plus afficher le PIN en clair dans l'UI connectée — retiré de l'en-tête (`App.tsx`), sensible en cas de capture d'écran.

---

## 🟡 P2 — Finition v1

- [ ] **Tests sur devices réels** : matrice iPhone (Safari + PWA installée) × Android (Chrome + PWA installée) × Windows 10/11. Vérifier : latence souris, taps, scroll, reconnexion après verrouillage écran, reconnexion après mise en veille PC. — non fait, nécessite du matériel physique.
- [x] **Onboarding première utilisation** — la fenêtre PIN (`main.ts` → `showPINWindow`) affiche maintenant une liste numérotée "1. Scanne le QR / 2. Accepte le certificat / 3. Entre le PIN".
- [x] **Page d'erreur certificat** : le bandeau d'erreur de connexion générique (`App.tsx` → `connect_error`) suggère maintenant systématiquement (pas seulement en mode standalone) d'ouvrir `https://IP:port` dans le navigateur pour accepter le certificat avant de réessayer.
- [x] **Nettoyage** : `libs/shared-ui` supprimé (inutilisé, aucune UI ne l'importait). `libs/shared-types` contient maintenant les vrais contrats d'événements (`ClientToServerEvents`, `ServerToClientEvents`, `Delta2D`, `VolumeState`, `AuthPayload`), publié comme package npm workspace réel `@glide/shared-types` (voir point suivant pour pourquoi).
- [x] **Typage Socket.io** des deux côtés à partir de `@glide/shared-types` : `Server<ClientToServerEvents, ServerToClientEvents>` côté serveur, `Socket<ServerToClientEvents, ClientToServerEvents>` côté client. Ce typage a révélé un vrai bug latent : `socket.on("reconnect"/"reconnect_failed", ...)` n'écoutait rien (ce sont des événements du *Manager*, pas du *Socket*, un piège classique de socket.io-client) — `reconnect_failed` déplacé sur `socket.io.on(...)`, `reconnect` supprimé (redondant, `connect` se redéclenche déjà après reconnexion).
  - Note technique : `@glide/shared-types` est un vrai package npm workspace (pas juste un alias `tsconfig.paths`) car l'exécuteur Nx `@nx/js:tsc` du serveur électron échoue avec `TS6059` si un fichier source est importé en dehors du `rootDir` du projet consommateur — passer par `node_modules` (symlink workspace) contourne cette contrainte proprement et préserve la structure de sortie `dist/src/main.js` attendue par `package.json#main`.
- [x] `@types/express` aligné sur `^4.17.21` (cohérent avec `express@^4.22.1`, `apps/server-electron/package.json`).
- [x] **Service worker** vérifié : `registerType: "autoUpdate"` active déjà automatiquement `skipWaiting`/`clientsClaim` côté vite-plugin-pwa (confirmé en lisant sa source) — aucune vieille version ne devrait rester servie. Pas de changement de code nécessaire.
- [x] README complété avec une section Android (Chrome → accepter le certificat → PIN → "Add to Home screen").
- [~] CI : `build:client` et `build:server` (mêmes étapes que `deploy-pwa.yml`/`release.yml`) validés en local après les changements ci-dessus — mais les workflows GitHub Actions eux-mêmes n'ont pas été exécutés (nécessiterait un push/tag).

## 🚀 Mise en ligne — release .exe + PWA hébergée

### Contexte architecture (à lire avant de commencer)

Contraintes : PWA hébergée sur Vercel, téléphone + PC **sur le même WiFi**, plusieurs utilisateurs simultanés (chacun son PC), et **aucun port à ouvrir**.

Aujourd'hui la PWA est servie par le PC lui-même et le téléphone se connecte **en direct** sur `wss://192.168.x.x:3000`. Deux approches écartées :

- **Garder la connexion directe `wss://IP:3000` depuis la PWA Vercel** : garde exactement ce qu'on veut supprimer (port 3000 dans le firewall + certificat auto-signé à accepter à la main), et le flow cert devient même *pire* (l'utilisateur est sur `glide.vercel.app`, il faut lui demander d'ouvrir `https://IP:3000` dans un autre onglet juste pour accepter le cert). En prime, Chrome est en train de restreindre les connexions site public → IP privée (Private Network Access) : cette approche est fragile à moyen terme.
- **Relay qui forwarde tous les events** : marcherait, mais chaque mouvement de souris ferait téléphone → internet → PC alors que les deux appareils sont sur le même WiFi. Latence et dépendance internet inutiles.

L'architecture qui coche les 4 contraintes : **WebRTC DataChannel en P2P sur le LAN, avec un mini serveur de signaling** qui ne sert qu'à la mise en relation (quelques Ko à la connexion, plus rien ensuite) :

```
            ┌───────────┐  wss sortant (signaling
            │ Signaling │  uniquement : SDP/ICE)
            │  (rooms)  │◄──────────────┐
            └─────▲─────┘               │
   wss sortant    │                     │
┌────────┐────────┘               ┌──────────┐
│ iPhone │                        │ PC Glide │
│ (PWA   │◄══════════════════════►│(Electron)│
│ Vercel)│  WebRTC DataChannel    └──────────┘
└────────┘  direct sur le LAN
```

- **Aucun port à ouvrir, aucune règle firewall** : le PC et le téléphone font chacun une connexion *sortante* vers le signaling, puis ICE négocie un chemin UDP direct sur le LAN (le firewall Windows laisse passer car le PC initie aussi des paquets sortants vers le téléphone — c'est le fonctionnement normal de WebRTC). Les scripts `setup-firewall` deviennent inutiles.
- **Plus de certificat auto-signé** : le DataChannel est chiffré par DTLS nativement, aucune acceptation manuelle. La PWA vient de Vercel en vrai HTTPS → installable proprement, y compris en PWA installée iOS.
- **Latence** : identique au mode direct actuel — les events restent sur le LAN. Bonus possible : canal `unreliable/unordered` pour `mouseDelta`/`scroll` (une frame perdue est écrasée par la suivante), canal fiable pour clics/volume/clavier.
- **Multi-utilisateurs** : chaque PC crée une room `sessionId` (`crypto.randomUUID()`) sur le signaling → sessions isolées, autant d'utilisateurs que de PC.
- ⚠️ **Vercel n'héberge que la PWA statique** : les fonctions serverless Vercel ne supportent pas les WebSockets persistants, donc le signaling doit vivre ailleurs. Recommandation : **Render free** (aucune carte bancaire requise à l'inscription, WebSockets supportés). Contrepartie : spin-down après 15 min d'inactivité, ~1 min de réveil sur la requête suivante — sans impact réel puisque la reconnexion auto (étape C) gère déjà la coupure de la connexion PC↔signaling. Railway et Fly.io écartés : les deux exigent désormais une carte bancaire dès l'inscription (plus de vrai free tier en 2026).
- ⚠️ Limite connue : sur un WiFi avec **isolation client** (réseaux invités, hôtels), le P2P est bloqué — mais la connexion directe actuelle l'est tout autant, donc rien de perdu. Un fallback "forward via le serveur" pourra s'ajouter en v2 si besoin.
- Internet reste nécessaire pour charger la PWA et pour le handshake (pas pour le trafic souris). Acceptable : un PC sans internet est un cas marginal.

### Étape A — Release GitHub du .exe actuel (aucun changement de code) ✅ Fait

- [x] **Créer un nouveau tag sur HEAD** : l'ancien tag/release `v1.0.0` (qui pointait sur `f54607e`, pré-P0/P1/P2, jamais vraiment fonctionnel) a été supprimé puis recréé sur le commit final (logo + fixes inclus) — `git tag -f v1.0.0 && git push origin v1.0.0` → le workflow `release.yml` a buildé le `.exe` et publié la GitHub Release.
- [x] Vérifier le run dans l'onglet **Actions** du repo (jamais exécuté pour de vrai jusqu'ici) et corriger si le build casse. Un vrai bug a été trouvé et corrigé : `electron-builder` refuse un `"electron": "^35.7.5"` en range dans `package.json` (doit être une version exacte pour télécharger le bon binaire) → pin sur `"35.7.5"`.
- [ ] Télécharger le `.exe` depuis la release et le tester sur une machine (installation, PIN, connexion téléphone). — non fait, nécessite du matériel physique.
- [x] Soigner les release notes (le template mentionnait encore le flow IP:3000 à la main d'avant P0/P1/P2) : mis à jour pour refléter le flow QR-first, trackpad/scroll/drag/clavier/volume, reconnexion auto, wake lock.
- [x] Nouveau logo (mark "swoosh" mint `#6EE7B7` sur fond `#0E0F12`, remplace l'ancien curseur) : régénéré sur toutes les icônes (PWA, `.exe`, tray) et intégré dans l'UI (client PWA + fenêtre PIN Electron) à la place du texte seul "Glide".
- [x] **GitHub Pages désactivé** : plus la peine de maintenir un déploiement cassé (le `base: "/"` de `vite.config.ts` ne matchait pas le sous-chemin `/glide/` servi par GitHub Pages, d'où l'icône générique "G" observée). Site Pages, historique des déploiements et environnement `github-pages` supprimés via l'API GitHub ; workflow `.github/workflows/deploy-pwa.yml` supprimé du repo (anticipe le point équivalent de l'étape E ci-dessous).

### Étape B — Le serveur de signaling (`apps/signaling`) ✅ Fait

- [x] Créer `apps/signaling` : petit serveur Node + socket.io (pas d'Electron, pas de nut-js). Logique implémentée :
  - Le PC émet `registerHost(sessionId)` → crée la room (re-register avec le même `sessionId` accepté pour la reconnexion après coupure : l'ancien téléphone connecté reçoit `peerLeft` et doit rejoindre à nouveau).
  - Le téléphone émet `joinSession(sessionId)` → le signaling relaie `offer`/`answer`/`iceCandidate` entre les deux sockets de la room, rien d'autre.
  - Le **PIN ne transite jamais par le signaling** (voir étape C).
  - Cleanup : room détruite quand le PC se déconnecte (+ `peerLeft` au téléphone) ; pas de heartbeat applicatif nécessaire, le ping/pong intégré de socket.io déclenche déjà `disconnect` sur coupure silencieuse.
  - Sécurité : `sessionId` = UUID v4 (généré côté PC, non devinable), rate-limit 20 `joinSession` invalides / IP / 5 min (lit `x-forwarded-for` en priorité, pertinent derrière le proxy Render). Route `GET /health` pour le health check Render.
  - Validé par un smoke test end-to-end (registerHost/joinSession/offer/answer/iceCandidate/disconnect/reconnexion/session inconnue) — script jetable, pas commité.
- [x] Étendre `@glide/shared-types` : `SignalingClientToServerEvents`/`SignalingServerToClientEvents` (`registerHost`, `joinSession`, `offer`, `answer`, `iceCandidate`, `hostRegistered`, `joinError`, `peerJoined`, `peerLeft`) + le protocole des messages DataChannel (`ControlChannelClientMessage`/`ControlChannelServerMessage`/`InputChannelMessage`, discriminated unions sur `type`, sérialisés en JSON — ils ne passent plus par socket.io une fois le P2P établi).
- [x] Scripts racine `dev:signaling`/`build:signaling` (mêmes conventions nx que `server-electron`/`client-pwa`). `apps/signaling` n'est pas inclus dans `build:all`/`dist:win` (c'est un déploiement séparé, pas embarqué dans l'exe).

### Étape C — Adapter le serveur Electron (WebRTC côté PC)

- [ ] Choisir l'implémentation WebRTC côté Electron — recommandation : **fenêtre `BrowserWindow` cachée** qui utilise l'API WebRTC native de Chromium (zéro dépendance native en plus) et communique avec le main process par IPC ; alternative : `node-datachannel` dans le main process (une dépendance native de plus à côté de nut-js, mais pas de fenêtre cachée).
- [ ] Au démarrage : connexion **sortante** au signaling (`socket.io-client`, URL configurable), génération du `sessionId`, `registerHost`. À chaque `joinSession` reçu : créer la `RTCPeerConnection`, échanger offer/answer/ICE via le signaling. Pas de STUN nécessaire (même LAN → host candidates suffisent).
- [ ] **Auth sur le DataChannel** : premier message du téléphone = `{type:"auth", pin}` → le PC valide (rate-limit 5 essais / 5 min repris de `main.ts:171-178`), répond `authResult`, et n'accepte les events d'input qu'après succès. Router ensuite les messages vers la logique nut-js existante (extraire les handlers actuels de `main.ts` dans un module partageable, indépendant de socket.io).
- [ ] Le QR code et la fenêtre PIN affichent `https://<app>.vercel.app/#s=<sessionId>` au lieu de `https://IP:3000`.
- [ ] Deux canaux : `input` en `{ordered:false, maxRetransmits:0}` pour `mouseDelta`/`scroll` (une frame perdue est remplacée par la suivante), `control` fiable pour clics, clavier, volume, auth.
- [ ] Supprimer (ou désactiver) ce qui devient inutile : serveur HTTPS local + génération/persistance de certificat, ouverture firewall (`setup-firewall.cjs`, `dev-server-wrapper.cjs`), service de la PWA par Express, affichage IP multi-interfaces. Recommandation : garder le code du mode LAN direct dans une branche/un commit taggé au cas où, mais ne pas maintenir deux modes dans l'exe.
- [ ] Reconnexion : si le signaling coupe (internet instable), re-register avec le **même** `sessionId` ; si le P2P coupe (verrouillage écran téléphone), le téléphone rejoint la room et on refait un handshake — l'UX de reconnexion auto existante (bandeau "Reconnexion…") doit continuer à marcher.

### Étape D — Adapter la PWA (WebRTC côté téléphone)

- [ ] URL du signaling via variable d'env Vite (`VITE_SIGNALING_URL`) injectée au build.
- [ ] Remplacer la connexion socket.io directe par : socket.io vers le signaling → `joinSession(sessionId)` → handshake WebRTC → DataChannels. Envoyer le PIN en premier message sur le canal `control`, attendre `authResult` avant d'afficher le trackpad.
- [ ] Écran de connexion : le scan QR (ou l'ouverture du lien `#s=<sessionId>`) fournit la session → il ne reste que le PIN à taper. Garder une saisie manuelle "code de session + PIN" en fallback (le `sessionId` affiché en court dans la fenêtre PIN du PC).
- [ ] Adapter l'envoi des events : le batching rAF existant reste, seul le transport change (DataChannel `input` au lieu de `socket.emit`). Clics/clavier/volume sur le canal `control`.
- [ ] Supprimer la logique devenue morte : saisie IP:port, messages d'aide "accepter le certificat", détection standalone liée au cert, `iceServers` vide (pas de STUN sur LAN).
- [ ] Mémorisation dernière connexion : stocker `sessionId` + PIN au lieu de IP + PIN.

### Étape E — Déploiements

- [ ] Déployer le signaling sur **Render free** (Web Service, pas de carte bancaire requise) : `npm start`, port fourni via `$PORT`, health check pour limiter les faux spin-down. Noter l'URL publique (ex. `glide-signaling.onrender.com`). Trafic quasi nul (handshakes uniquement) → free tier largement suffisant, spin-down 15 min / réveil ~1 min accepté.
- [ ] Déployer la PWA sur Vercel : importer le repo GitHub, build command `npx nx build client-pwa`, output `dist/apps/client-pwa`, variable `VITE_SIGNALING_URL`. Ajouter un `vercel.json` avec le rewrite SPA (`/(.*)` → `/index.html`) et vérifier que `manifest.webmanifest` + `sw.js` sont servis avec les bons headers.
- [x] Supprimer (ou désactiver) `.github/workflows/deploy-pwa.yml` (GitHub Pages) pour ne pas maintenir deux versions de la PWA — fait en avance (étape A) : workflow supprimé, site Pages/déploiements/environnement nettoyés côté GitHub. Vercel se redéploiera tout seul à chaque push sur `main`.
- [ ] Vérifier l'installabilité PWA depuis le domaine Vercel (vrai HTTPS → plus aucun souci de certificat, y compris en PWA installée iOS 🎉).

### Étape F — Validation & release finale

- [ ] Test multi-utilisateurs : 2 PC + 2 téléphones **sur le même WiFi** en simultané (rooms isolées, aucun cross-talk entre les deux paires).
- [ ] Vérifier la latence souris (doit être équivalente au mode direct actuel puisque le trafic reste sur le LAN) et la reconnexion après verrouillage d'écran du téléphone.
- [ ] Tester sur un WiFi avec isolation client (si dispo) pour confirmer le message d'erreur — le P2P doit échouer proprement avec une explication, pas un spinner infini (timeout sur l'établissement de la connexion ICE).
- [ ] Mettre à jour README (nouvelle architecture, URL Vercel, sections firewall/certificat obsolètes) et `RELEASES.md`.
- [ ] Tagger `v1.2.0` : nouvelle release `.exe` **incluant le mode WebRTC** (l'exe de l'étape A ne connaît que le mode LAN direct).

---

## 🔵 v2 (hors scope v1, à ne pas commencer avant)

- [ ] Support **macOS** serveur (nut-js fonctionne, gérer les permissions Accessibilité macOS + firewall).
- [ ] Wrapper **Capacitor** iOS/Android pour les boutons volume physiques + meilleure intégration (cf. P0.3 option B).
- [ ] Découverte auto du serveur sur le LAN (mDNS/Bonjour côté Electron + tentative de connexion sur les IP du sous-réseau côté client — un navigateur ne peut pas faire de mDNS, donc scan limité ou QR reste le chemin principal).
- [ ] Gestes avancés : pinch-to-zoom, 3 doigts = alt-tab, geste médias (play/pause, next).
- [ ] Multi-clients / kick d'un client depuis le tray.
- [ ] **Support hors-LAN** (téléphone en 4G, PC ailleurs) : ajouter STUN aux `iceServers` (serveurs publics gratuits) + fallback "forward des events via le signaling" quand ICE échoue (WiFi à isolation client, NAT symétrique). L'infra signaling de la mise en ligne est déjà prête pour ça.

---

## Ordre d'attaque suggéré

1. ~~**Trackpad** (P0.1 + P0.2) — c'est le cœur du produit : accumulation des deltas + rAF côté client, boucle d'application côté serveur, fix du double-clic et du seuil de tap. Testable immédiatement en dev.~~ ✅ Fait
2. ~~**Robustesse connexion** (P0.4) — cert persistant, wake lock, reconnexion auto, fonts locales.~~ ✅ Fait
3. ~~**Volume** (P0.3) — supprimer le listener clavier mort, brancher le slider sur `loudness`, sync du volume réel.~~ ✅ Fait
4. ~~**Assets & tray** (P1) — icônes PWA + tray + installeur.~~ ✅ Fait
5. ~~**Scroll 2 doigts + drag + clavier + QR-first + erreurs + déconnexion + pull-to-refresh** (P1).~~ ✅ Fait
6. ~~**Sécurité — trancher HTTPS vs HTTP+WS local**~~ ✅ Fait (HTTPS conservé, PIN retiré de l'UI)
7. ~~**Onboarding, guidage certificat, typage Socket.io, cleanup libs, README Android**~~ ✅ Fait
8. **Tests sur devices réels** (P2, seul point restant). — toujours en attente de matériel physique.
9. ~~**Mise en ligne — étape A** : release `.exe` v1.0.0 (tag, build, release notes, fix electron-builder, nouveau logo, cleanup GitHub Pages).~~ ✅ Fait
10. ~~**Mise en ligne — étape B** : serveur de signaling `apps/signaling` (rooms, relais SDP/ICE, rate-limit, health check) + types partagés.~~ ✅ Fait
11. **Mise en ligne — étapes C→F** : WebRTC côté Electron (étape C) + côté PWA (étape D) + déploiements Render/Vercel (étape E) + validation (étape F). Étapes C et D réécrivent la couche transport des deux apps existantes (remplacent la connexion directe HTTPS/socket.io) — checkpoint avec Elwen avant de commencer vu l'ampleur. ← prochaine étape

> **P0, P1 et la quasi-totalité du P2 sont traités, et les étapes A+B de la mise en ligne aussi.** Le workflow `release.yml` a maintenant vraiment tourné (contrairement à avant) : ça a révélé et corrigé un bug réel (`electron-builder` exige une version Electron fixe, pas un range semver). La release `v1.0.0` est publiée avec le `.exe`, GitHub Pages est désactivé et nettoyé (remplacé par Vercel dans la suite du plan), le logo a été mis à jour partout (icônes + UI), et le serveur de signaling WebRTC (`apps/signaling`) est écrit et testé (smoke test end-to-end). Seul le P2 "tests sur devices réels" (matrice iPhone/Android/Windows physique) et le test manuel de l'installeur `.exe` restent hors de portée sans matériel physique — tout le reste est fait. Prochaine étape : rewiring WebRTC côté Electron (C) et PWA (D), puis déploiements (E) et validation (F).
