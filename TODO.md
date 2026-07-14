# TODO — Glide v2

v1 est livré : trackpad + volume + WebRTC P2P (signaling sur Render, PWA sur Vercel), release `v1.1.0`. Historique complet du développement v1 dans l'historique git de ce fichier.

## v2 (hors scope v1)

- [ ] Support **macOS** serveur (nut-js fonctionne, gérer les permissions Accessibilité macOS + firewall).
- [ ] Wrapper **Capacitor** iOS/Android pour les boutons volume physiques + meilleure intégration.
- [ ] Découverte auto du serveur sur le LAN (mDNS/Bonjour côté Electron + tentative de connexion sur les IP du sous-réseau côté client — un navigateur ne peut pas faire de mDNS, donc scan limité ou QR reste le chemin principal).
- [ ] Gestes avancés : pinch-to-zoom, 3 doigts = alt-tab, geste médias (play/pause, next).
- [ ] Multi-clients / kick d'un client depuis le tray.
- [ ] **Support hors-LAN** (téléphone en 4G, PC ailleurs) : ajouter STUN aux `iceServers` (serveurs publics gratuits) + fallback "forward des events via le signaling" quand ICE échoue (WiFi à isolation client, NAT symétrique). L'infra signaling est déjà prête pour ça.
