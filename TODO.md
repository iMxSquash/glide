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

## 🔵 v2 (hors scope v1, à ne pas commencer avant)

- [ ] Support **macOS** serveur (nut-js fonctionne, gérer les permissions Accessibilité macOS + firewall).
- [ ] Wrapper **Capacitor** iOS/Android pour les boutons volume physiques + meilleure intégration (cf. P0.3 option B).
- [ ] Découverte auto du serveur sur le LAN (mDNS/Bonjour côté Electron + tentative de connexion sur les IP du sous-réseau côté client — un navigateur ne peut pas faire de mDNS, donc scan limité ou QR reste le chemin principal).
- [ ] Gestes avancés : pinch-to-zoom, 3 doigts = alt-tab, geste médias (play/pause, next).
- [ ] Multi-clients / kick d'un client depuis le tray.

---

## Ordre d'attaque suggéré

1. ~~**Trackpad** (P0.1 + P0.2) — c'est le cœur du produit : accumulation des deltas + rAF côté client, boucle d'application côté serveur, fix du double-clic et du seuil de tap. Testable immédiatement en dev.~~ ✅ Fait
2. ~~**Robustesse connexion** (P0.4) — cert persistant, wake lock, reconnexion auto, fonts locales.~~ ✅ Fait
3. ~~**Volume** (P0.3) — supprimer le listener clavier mort, brancher le slider sur `loudness`, sync du volume réel.~~ ✅ Fait
4. ~~**Assets & tray** (P1) — icônes PWA + tray + installeur.~~ ✅ Fait
5. ~~**Scroll 2 doigts + drag + clavier + QR-first + erreurs + déconnexion + pull-to-refresh** (P1).~~ ✅ Fait
6. ~~**Sécurité — trancher HTTPS vs HTTP+WS local**~~ ✅ Fait (HTTPS conservé, PIN retiré de l'UI)
7. ~~**Onboarding, guidage certificat, typage Socket.io, cleanup libs, README Android**~~ ✅ Fait
8. **Tests sur devices réels** (P2, seul point restant), puis release. ← prochaine étape

> **P0, P1 et la quasi-totalité du P2 sont traités.** Testé par build + typecheck (`tsc --noEmit`) sur les deux apps après chaque changement. Seul le P2 "tests sur devices réels" (matrice iPhone/Android/Windows physique) et l'exécution effective des workflows GitHub Actions restent hors de portée sans matériel/CI réels — tout le reste (onboarding, typage, cleanup, README, `@types/express`) est fait.
