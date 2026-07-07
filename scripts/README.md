# Setup Scripts

Scripts pour configurer Glide au démarrage.

## Auto-démarrage

### Activer
```bash
npm run setup:autostart
```

### Désactiver
```bash
npm run remove:autostart
```

**Fonctionnement :**
- **Windows :** Ajoute Glide au registre pour démarrage auto
- **macOS :** Ajoute Glide aux Login Items

Pas de configuration firewall nécessaire : le transport est WebRTC, la connexion PC↔téléphone est toujours initiée en sortant des deux côtés (voir TODO.md, section "Mise en ligne").

## Installation complète

```bash
# 1. Build l'application
npm run build:all
npm run dist:win  # ou dist:mac

# 2. Activer auto-démarrage
npm run setup:autostart
```

## Désinstallation

```bash
# Désactiver auto-démarrage
npm run remove:autostart
```
