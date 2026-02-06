# Releases

## Créer une nouvelle release

### 1. Tag une nouvelle version

```bash
# Créer et pusher un tag
git tag v1.0.0
git push origin v1.0.0
```

### 2. GitHub Actions build automatiquement

Le workflow `.github/workflows/release.yml` va :
- ✅ Builder pour Windows (.exe)
- ✅ Builder pour macOS (.dmg)
- ✅ Créer une GitHub Release
- ✅ Upload les installeurs comme assets

### 3. Les utilisateurs téléchargent

Les gens peuvent télécharger depuis :
```
https://github.com/YOUR_USERNAME/glide/releases/latest
```

## Format des versions

Utiliser [Semantic Versioning](https://semver.org/) :
- `v1.0.0` - Release majeure
- `v1.1.0` - Nouvelles fonctionnalités
- `v1.0.1` - Bug fixes

## Exemple de release notes

```markdown
## Glide v1.0.0

### 🎉 Première release

#### Fonctionnalités
- Contrôle PC depuis iPhone
- Trackpad multitouch
- Volume control avec boutons iOS
- Gestion automatique firewall
- PWA installable

#### Installation
Télécharger l'installeur pour votre OS
```

## Configuration GitHub

### Activer GitHub Actions

1. Aller dans `Settings` → `Actions` → `General`
2. Activer "Allow all actions"

### Permissions

Le workflow utilise `GITHUB_TOKEN` automatiquement fourni par GitHub.
Aucune configuration supplémentaire nécessaire.

## Test local

```bash
# Tester le build avant de pusher un tag
npm run build:all
npm run dist:win  # ou dist:mac
```
