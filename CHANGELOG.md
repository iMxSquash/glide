# Changelog

Toutes les modifications notables de ce projet sont documentées dans ce fichier.

Le format suit [Keep a Changelog](https://keepachangelog.com/fr/1.1.0/), et ce projet adhère au [Semantic Versioning](https://semver.org/lang/fr/).

## [Unreleased]

### Changed
- QR code et PWA packagée pointant vers `app.glide.elwen.dev` au lieu de `glide.elwen.dev`, qui devient la landing page

## [1.2.0] - 2026-07-08

### Changed
- Mise à jour de React et react-dom vers 19 (`client-pwa`)
- Mise à jour de Nx et `@nx/workspace` vers 23
- Mise à jour de `@zxing/library` vers 0.23
- Mise à jour des GitHub Actions (`checkout`, `setup-node`, `upload-artifact`, `download-artifact`, `action-gh-release`)

## [1.1.2] - 2026-07-08

### Added
- Affichage de la version de l'app et lien GitHub dans le menu de la barre système
- Option de lancement au démarrage dans le menu de la barre système

## [1.1.1] - 2026-07-07

### Fixed
- QR code pointant vers `glide.elwen.dev`
- Écran de chargement pendant la reconnexion automatique silencieuse

## [1.1.0] - 2026-07-07

### Added
- Serveur de signaling WebRTC (`apps/signaling`)
- Transport WebRTC côté client PWA

### Changed
- Remplacement du mode LAN direct par WebRTC, plus de double transport (breaking change)

### Fixed
- Relâchement du bouton de souris à la fermeture du canal de contrôle
- Attente du chargement de la fenêtre cachée avant le signaling
- Validation des champs numériques reçus via le DataChannel
- Auto-reconnexion non interrompue par une `joinError` transitoire
- Envoi de l'état de volume réel juste après l'authentification WebRTC
- Build packagé pointant par défaut sur le signaling/PWA déployés
- Blueprint Render non figé sur une branche de fonctionnalité

## [1.0.0] - 2026-07-07

### Added
- Première version publique : contrôle du PC depuis le téléphone via gestes trackpad
- Trackpad multitouch, clavier virtuel, contrôle du volume
- Onboarding par QR code et authentification par PIN
- Gestion du certificat auto-signé et du firewall Windows
- PWA installable sur iPhone/Android

[Unreleased]: https://github.com/iMxSquash/glide/compare/v1.2.0...HEAD
[1.2.0]: https://github.com/iMxSquash/glide/compare/v1.1.2...v1.2.0
[1.1.2]: https://github.com/iMxSquash/glide/compare/v1.1.1...v1.1.2
[1.1.1]: https://github.com/iMxSquash/glide/compare/v1.1.0...v1.1.1
[1.1.0]: https://github.com/iMxSquash/glide/compare/v1.0.0...v1.1.0
[1.0.0]: https://github.com/iMxSquash/glide/releases/tag/v1.0.0
