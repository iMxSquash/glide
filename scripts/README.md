# Setup Scripts

Scripts pour configurer Glide au démarrage et gérer le firewall.

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

## Firewall

### Ouvrir le port 3000
```bash
npm run setup:firewall
```

### Fermer le port 3000
```bash
npm run remove:firewall
```

**Fonctionnement :**
- **Windows :** Configure automatiquement Windows Firewall (nécessite droits admin)
- **macOS :** Pas nécessaire, macOS demande automatiquement l'autorisation

## Comportement automatique

L'app Electron gère automatiquement le firewall :
- ✅ **Au lancement :** Ouvre le port 3000 (Windows uniquement)
- ✅ **À la fermeture :** Ferme le port 3000 (Windows uniquement)

Sur macOS, aucune configuration firewall n'est nécessaire - le système demande l'autorisation automatiquement.

## Installation complète

```bash
# 1. Build l'application
npm run build:all
npm run dist:win  # ou dist:mac

# 2. Activer auto-démarrage
npm run setup:autostart

# 3. Ouvrir le port (Windows uniquement, nécessite admin)
npm run setup:firewall
```

## Désinstallation

```bash
# Désactiver auto-démarrage
npm run remove:autostart

# Fermer le port (Windows)
npm run remove:firewall
```
