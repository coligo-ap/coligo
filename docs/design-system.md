# Design System Coligo

- **Tokens** : `app/design-tokens.css` — couleurs, typo, rayons, ombres, durées, thèmes clair/sombre et tokens d'espace (`--d-*`). Seule source de vérité.
- **Miroir TypeScript** : `lib/design/tokens.ts` — pour ce qui ne lit pas le CSS (cartes MapLibre, PDF, canvas, APIs natives). Les deux fichiers doivent rester alignés.
- **Vitrine** : `/design-system` (accès équipe Coligo) — palette, typo et chaque composant dans toutes ses variantes, en clair/sombre et LTR/RTL. Le visuel EST la documentation.
- **Principe** : **on modifie le TOKEN, jamais le composant.** Une couleur écrite en dur dans un `.tsx` est un bug : elle échappe au mode sombre et à toute évolution de la charte.
- **Ajouter un composant** : le poser dans `components/ui/`, n'utiliser QUE des classes de tokens (`bg-surface`, `text-muted`, `rounded-control`, `text-caption`), varier avec `cva`, et utiliser les propriétés **logiques** (`ms-`/`me-`, `start-`/`end-`) pour rester juste en arabe.
- **Avant d'en créer un** : vérifier qu'il n'existe pas déjà — `Button`, `Badge`, `Input`, `Field`, `Sheet`, `Segmented`, `Toggle`, `EmptyState`, `Skeleton`, `Spinner`, `Toast`, `Confirm`.
- **Design FLAT** : bordures et fonds doux, jamais d'ombre décorative ; l'élévation (`shadow-float`, `shadow-overlay`) est réservée aux éléments **flottants**.
- **Garde-fou** : `npm run lint:ds` refuse toute couleur ou valeur d'échelle ajoutée en dur. L'existant non encore repris est figé dans `scripts/design-tokens-baseline.json` — le compteur ne peut que descendre ; après une reprise, re-figer avec `npm run lint:ds -- --update`.
