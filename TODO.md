# TODO — Glide v2

v1 est livré : trackpad + volume + WebRTC P2P (signaling sur Render, PWA sur Vercel), release `v1.1.0`. Historique complet du développement v1 dans l'historique git de ce fichier.

## v2 (hors scope v1)

- [ ] Support **macOS** serveur (nut-js fonctionne, gérer les permissions Accessibilité macOS + firewall).
- [ ] Wrapper **Capacitor** iOS/Android pour les boutons volume physiques + meilleure intégration.
- [ ] Découverte auto du serveur sur le LAN (mDNS/Bonjour côté Electron + tentative de connexion sur les IP du sous-réseau côté client — un navigateur ne peut pas faire de mDNS, donc scan limité ou QR reste le chemin principal).
- [ ] Gestes avancés : pinch-to-zoom, 3 doigts = alt-tab, geste médias (play/pause, next).
- [ ] Multi-clients / kick d'un client depuis le tray.
- [ ] **Support hors-LAN** (téléphone en 4G, PC ailleurs) : ajouter STUN aux `iceServers` (serveurs publics gratuits) + fallback "forward des events via le signaling" quand ICE échoue (WiFi à isolation client, NAT symétrique). L'infra signaling est déjà prête pour ça.

## Landing page (glide.elwen.dev)

Décisions actées : landing dans ce repo (nouvelle app Nx `apps/landing`), déployée sur `glide.elwen.dev` ; la PWA migre vers `app.glide.elwen.dev`. L'URL de la PWA n'est codée qu'à un seul endroit (`apps/server-electron/src/main.ts:24`) et le signaling a `cors: { origin: "*" }`, donc rien à changer côté Render.

### Phase 1 — Nouvelle app `apps/landing`

- [x] App Vite statique **HTML + TypeScript vanilla + Tailwind 4** (déjà dans le workspace, zéro nouvelle dépendance, pas de React : contenu statique = meilleur SEO/LCP qu'une SPA).
- [x] `project.json` Nx avec targets `build` (sortie `dist/apps/landing`) et `serve`.
- [x] Respecter `DESIGN_SYSTEM.md` : dark mode par défaut (`#0E0F12` / `#16181D`), light mode équivalent strict (`prefers-color-scheme`), esthétique Apple-like sobre. Animations "wow" à ajouter en phase 2 avec le vrai contenu.

### Phase 2 — Contenu (une page, en anglais)

- [x] **Hero** : tagline du README, logo réutilisé, CTA "Download for free" + lien GitHub.
- [x] **Features** : les 6 features du README (trackpad multitouch, volume, clavier, PWA, P2P chiffré, zéro config).
- [x] **How it works** : 3 étapes (installer, scanner le QR, entrer le PIN) + explication P2P vulgarisée.
- [x] **Download** : fetch de l'API GitHub releases (`main.ts`) pour version + liens `.exe`/`.dmg` réels, liens statiques `releases/latest` en fallback si l'API échoue ou si l'asset n'existe pas encore (macOS aujourd'hui).
- [x] **Privacy/Security** : le signaling ne voit jamais les inputs (argument fort, citable pour le GEO).
- [x] **FAQ** : 6 questions (compatibilité, sécurité, hors-LAN, réseaux avec isolation, licence) en `<details>` natifs, base du futur JSON-LD `FAQPage`.
- [x] Footer : GitHub, licence GPL-3.0-or-later. Lien vers `app.glide.elwen.dev` différé à la phase 5 (le sous-domaine n'existe pas encore).

### Phase 3 — SEO / GEO

- [x] `<title>`, meta description, canonical, Open Graph + Twitter Card avec image 1200×630 (générée en SVG puis rasterisée, tokens `DESIGN_SYSTEM.md`).
- [x] JSON-LD `SoftwareApplication` + `FAQPage` (synchronisé avec les 6 questions de la page), `sitemap.xml`, `robots.txt`, `llms.txt`.
- [x] Logo du header en WebP redimensionné (19 Ko → ~1 Ko) avec `width`/`height` réservés et `fetchpriority="high"`. Pas de web fonts (Inter/Manrope) : choix assumé pour zéro requête et zéro `CLS` de `font-swap`, documenté dans `style.css` (déviation du `DESIGN_SYSTEM.md` sur ce point précis).

### Phase 4 — Déploiement Vercel

- [x] Projet Vercel `glide-landing` créé (`team_53ANQFiamuZjPr1rNx3a4hkh` / `b2bs-projects-d4663ea5`, id `prj_LcjwAJzD5RmsOrP0boXdtbiYWwtD`) avec `apps/landing/vercel.json` (`buildCommand: npx nx build landing`, `outputDirectory: ../../dist/apps/landing`), committé sur la branche.
- [x] Root Directory réglé sur `apps/landing` et repo GitHub `iMxSquash/glide` connecté (fait via le dashboard, le CLI ne permet pas de régler le Root Directory après coup).
- [x] Déploiement preview vérifié en réel : Vercel détecte Nx (`Detected Nx. Adjusting default settings...`), installe depuis la racine du monorepo (`npm install --prefix=../..`), build `nx run landing:build` et sert les assets publics (`robots.txt`, `sitemap.xml`, `og-image.png`) correctement (redirection SSO sur l'URL preview : protection par défaut des previews Vercel, normal, pas un bug).
- [ ] Assigner `glide.elwen.dev` à ce projet (après la phase 5, l'ordre compte).

### Phase 5 — Migration de la PWA vers `app.glide.elwen.dev`

- [ ] Ajouter le domaine `app.glide.elwen.dev` au projet Vercel existant (CNAME côté DNS elwen.dev) : la PWA répond sur les deux URLs pendant la transition.
- [ ] Changer l'URL dans `apps/server-electron/src/main.ts:24` → `https://app.glide.elwen.dev`, mettre à jour `CHANGELOG.md`, publier une release du serveur Electron.
- [ ] Une fois la release diffusée, retirer `glide.elwen.dev` du projet PWA et l'assigner au projet landing.
- [ ] Casse assumée : les PWA déjà installées sur téléphone tomberont sur la landing, il faudra re-scanner le QR. Bandeau "Looking for the app? → app.glide.elwen.dev" sur la landing pour amortir.

### Phase 6 — Finitions

- [ ] Mettre à jour le README (lien vers la landing) et `.github` si besoin.
- [ ] Si glide est embarqué dans le portfolio macOS (elwen.dev), passer le skill `portfolio-embed-check` sur `app.glide.elwen.dev`.
- [ ] Lint + build Nx des deux apps, Lighthouse (perf, SEO, a11y ≥ 90) avant de basculer le domaine.
