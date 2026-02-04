# Glide — Direction Artistique & Design System

## 1. Vision produit
Glide est une solution **premium, utilitaire et intuitive** permettant de contrôler un PC Windows depuis un iPhone (web pwa) sur le même réseau WiFi (trackpad tactile, clics, volume).

Le produit doit :
- disparaître visuellement au profit de l’usage
- être immédiatement compréhensible
- privilégier le confort et la précision
- éviter toute complexité inutile

Glide n’est PAS :
- une usine à options
- un produit démonstratif ou gadget
- un produit “IA”, futuriste ou expérimental

---

## 2. ADN de marque

### Mots-clés
- Fluide
- Précis
- Élégant

### Image recherchée
- Premium
- Minimaliste
- Sérieuse mais accessible
- Inspirée de l’écosystème Apple (sobriété, hiérarchie claire)

### Références visuelles
- Apple (UI, sobriété fonctionnelle)
- Gentle Mates (maîtrise, sérieux)
- Ciao Kombucha (douceur contrôlée)

---

## 3. Principes UI fondamentaux

- Dark Mode prioritaire (Light Mode équivalent strict)
- Peu d’éléments à l’écran
- Gestes avant boutons
- Hiérarchie claire
- Pas d’éléments décoratifs non fonctionnels
- Toute animation doit servir la compréhension ou le feedback
- Pas d’animations “wow” sauf pour la landing page

---

## 4. Palette couleurs — Dark Mode (par défaut)

### Fonds
- Background principal : `#0E0F12`
- Surface secondaire (cards / zones tactiles) : `#16181D`

### Texte
- Texte principal : `#F2F2F3`
- Texte secondaire : `#9A9DA3`
- Texte désactivé : `#6B6E75`

### Accent
- Accent principal (interactions) : `#6EE7B7`
- Accent secondaire optionnel (feedback léger uniquement) : `#A5B4FC`

### Règles
- Un seul accent coloré visible à la fois
- Jamais de couleurs flashy
- Pas de noir pur `#000000`

---

## 5. Palette couleurs — Light Mode

### Fonds
- Background principal : `#F7F8FA`
- Surface secondaire : `#FFFFFF`
- Surface alternative : `#EEF0F4`

### Texte
- Texte principal : `#0E0F12`
- Texte secondaire : `#6B7280`
- Texte désactivé : `#A1A6B0`

### Accent
- Accent principal : `#6EE7B7`
- Accent secondaire optionnel : `#A5B4FC`

### États UI
- Hover / actif : fond `#E6F7F0`
- Séparateurs : `#E2E4E9`

---

## 6. Typographies

### Texte UI
**Inter**
- Poids utilisés : 400 (Regular), 500 (Medium), 600 (SemiBold)
- Priorité à la lisibilité et à la neutralité

### Titres / branding
- **Manrope**

### Règles typographiques
- Pas de typographies “tech” ou monospace pour l’UI
- Pas d’effets (ombres, contours, gradients)

---

## 7. Formes & layout

### Formes
- Rayon de bordure standard : 12–16px
- Coins légèrement arrondis (pas ludiques)
- Surfaces pleines, sans bordures visibles

### Layout
- Espaces généreux
- Alignements stricts
- Peu de niveaux de profondeur

---

## 8. Iconographie

- Style minimal
- Ligne fine ou semi-pleine
- Icônes explicites uniquement
- Peu nombreuses
- Pas d’icônes décoratives
- Pas d'emoji

---

## 9. Logo — Directives (déjà réalisé)

### Ce que le logo doit exprimer
- Mouvement fluide
- Précision
- Silence technologique
- Confiance

### Ce que le logo ne doit PAS contenir
- Curseur, souris, trackpad
- Smartphone ou PC
- Ondes WiFi
- Symboles Remote Desktop
- Effets futuristes ou IA

### Directions acceptées
- Mot-symbole “glide” (minuscules)
- Icône abstraite basée sur une ligne ou une courbe fluide
- Forme simple, lisible à petite taille

### Style
- Flat
- Sans gradients
- Fond sombre ou clair selon le mode
- Accent unique

---

## 10. Animations & feedback

- Animations courtes et discrètes
- Durées recommandées : 150–250ms
- Courbes ease-in-out naturelles
- Feedback visuel clair pour les gestes (tap, swipe, drag)
- Aucune animation décorative

---

## 11. Contraintes techniques (à respecter dans l’UI)

- Client : PWA (iOS)
- Utilisation intensive du tactile (Pointer Events)
- Trackpad = surface principale
- UI optimisée pour usage fréquent (canapé, lit, bureau)
- Dark Mode obligatoire

---

## 12. Règle finale

Si un élément :
- n’améliore pas l’usage
- n’améliore pas la compréhension
- n’améliore pas le confort

➡ il doit être supprimé.

Glide doit rester **calme, précis et invisible**.