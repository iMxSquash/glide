# Contributing to Glide

## Setup

Voir le [README](README.md#quick-start) pour l'installation et le lancement en local (`dev:server`, `dev:client`, `dev:signaling`).

## Workflow

1. Fork le repo, ou crée une branche si tu as les droits d'écriture.
2. Nomme ta branche `type/description-courte` (ex. `feat/keyboard-shortcuts`, `fix/reconnect-loop`).
3. Commit avec le format [Conventional Commits](https://www.conventionalcommits.org/) : `type(scope): description` (ex. `fix(client): prevent double reconnect on wake`).
4. Ouvre une Pull Request vers `main` en remplissant le template. Lie l'issue concernée avec `Closes #42`.
5. La CI doit être verte avant merge (squash and merge par défaut).

## Build et vérification locale

```bash
npm install
npm run lint               # ESLint sur tout le monorepo
npm run build:all          # build client + server
npm run build:signaling    # build du serveur de signaling
```

Il n'y a pas encore de suite de tests automatisée sur ce projet : lint + build (`tsc`) sont les seules vérifications statiques disponibles pour l'instant.

## Standards de code

- TypeScript strict, pas de `any`.
- Un commit = un changement logique, ne pas mélanger refactoring et fonctionnalité.
- Suivre le style existant du code voisin (structure Nx, conventions par app dans `apps/*`).

## Signaler un bug ou proposer une fonctionnalité

Utilise les templates d'issues dédiés (bug report / feature request). Pour une vulnérabilité de sécurité, voir [SECURITY.md](SECURITY.md), jamais via une issue publique.
