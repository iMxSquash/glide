# SEO / GEO — glide.elwen.dev

## Déjà fait

- Metadata : `<title>`, description, canonical, Open Graph + Twitter Card (image 1200×630)
- JSON-LD : `WebSite`, `SoftwareApplication`, `FAQPage` (synchronisé avec la FAQ affichée)
- `sitemap.xml`, `robots.txt` (accès explicite pour GPTBot/ClaudeBot/PerplexityBot/Google-Extended), `llms.txt`
- Lighthouse (build de production) : 100/100/100/100 (Performance/Accessibility/Best Practices/SEO), LCP 1.3s (mobile) / 0.3s (desktop), CLS 0
- Domaine `glide.elwen.dev` live sur le projet `glide-landing`, tous les assets vérifiés en production

## Reste à faire (actions manuelles, comptes externes)

### 1. Google Search Console

1. Ajouter la propriété `glide.elwen.dev` sur https://search.google.com/search-console
2. Vérifier la propriété (TXT DNS chez le registrar, ou balise meta)
3. Soumettre `https://glide.elwen.dev/sitemap.xml`
4. Demander une indexation manuelle de `https://glide.elwen.dev/` (outil d'inspection d'URL)

### 2. Bing Webmaster Tools

1. https://www.bing.com/webmasters — possibilité d'importer directement une propriété déjà vérifiée sur Google Search Console (plus rapide qu'une vérification manuelle)
2. Soumettre le même sitemap
3. Important pour le GEO : Bing alimente aussi ChatGPT Search, souvent oublié

### 3. Validation rich results

- https://search.google.com/test/rich-results sur `https://glide.elwen.dev/` : vérifier que Google lit bien `SoftwareApplication` et `FAQPage` sans erreur

### 4. Validation du partage social

- https://www.opengraph.xyz sur `https://glide.elwen.dev/` : vérifier le rendu réel de la carte Open Graph (Twitter/LinkedIn/Slack…)

### 5. Suivi de l'indexation

- Après soumission, l'indexation prend de quelques jours à ~2 semaines
- Vérifier ensuite avec `site:glide.elwen.dev` sur Google pour voir ce qui a été retenu
