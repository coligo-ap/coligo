# Design system Coligo — couleurs & mode sombre

> **Règle d'or.** Aucune couleur de **texte, fond, bordure ou surface** ne
> s'écrit en dur (`#fff`, `white`, `text-white`, `bg-[#xxx]`, `style={{ color:
"#…" }}`). Toute couleur passe par un **token de thème** qui possède une valeur
> claire **et** une valeur sombre. Le texte ne fixe jamais sa couleur seul : il
> utilise un token (`text-foreground`, `text-muted`) qui s'adapte au thème.

## Pourquoi (le bug qu'on évite)

En mode sombre, une couleur figée ne bascule pas. Symptômes vécus : barre de
recherche « Dini mn » (texte blanc sur fond violet pâle figé), feuille « Point
de départ » (libellés clairs sur surface restée blanche). **Cause racine
double** :

1. **Surface claire figée** (`#F6F3FE`, `#EEEEFD` en style inline) sous un texte
   qui, lui, bascule (`var(--d-ink)` → blanc en sombre) ⇒ blanc sur clair.
2. **Fuite de scope par les Portals.** Les feuilles/modales sont montées dans
   `document.body` (hors `.drive-jakarta`). Les tokens `--d-*` n'y étaient
   définis qu'en clair (`:root`) ⇒ surface blanche + texte clair = invisible.
   Corrigé en appliquant les `--d-*` sombres aussi à `<body>` sous `.theme-dark`
   (cf. `app/globals.css`).

## Quels espaces ont un mode sombre

| Espace                        | Scope                        | Tokens                           |
| ----------------------------- | ---------------------------- | -------------------------------- |
| Client (marketplace)          | `[data-space="client"]`      | `--color-*` (remap sombre)       |
| Drive / chauffeur             | `.drive-jakarta` + `<body>`  | `--d-*` **et** `--color-*`       |
| Livreur                       | `[data-space="driver"].dark` | `--color-*` (remap sombre)       |
| **Commerçant / admin / auth** | —                            | **Toujours clair** (pas de dark) |

Commerçant/admin/auth forcent `color-scheme: light` : leurs `bg-white` /
`text-white` ne sont **pas** des bugs et ne doivent pas être « corrigés ».

## Tokens à utiliser

### Tokens sémantiques globaux (client, livreur, Drive)

Exposés en utilitaires Tailwind via `@theme` (basculent en sombre) :

| Usage                        | Token / classe                           |
| ---------------------------- | ---------------------------------------- |
| Texte principal              | `text-foreground`                        |
| Texte secondaire/placeholder | `text-muted` / `text-subtle`             |
| Fond de page                 | `bg-background`                          |
| Carte / surface              | `bg-surface` (+ `bg-surface-2/-3`)       |
| Bordure                      | `border-border` (`border-border-strong`) |
| Accent de marque             | `bg-primary-600` `text-primary-700` …    |

### Tokens Drive (`--d-*`, espace `.drive-jakarta`)

`--d-surface` (carte/feuille) · `--d-ink` (encre) · `--d-muted` (atténué) ·
`--d-line` (bordure) · `--d-soft` (fond doux) · `--d-page` (fond) ·
`--d-accent` (violet pâle des badges/tuiles « Coligo ») · `--d-field` (fond des
champs de saisie). Usage : `bg-[var(--d-surface)]`, `text-[var(--d-ink)]`, etc.

> `text-white` n'est légitime **que** sur une surface **colorée pleine** (bouton
> violet plein, badge coloré). Jamais sur une surface de thème.

## Composants thémés réutilisables (`components/ui/themed.tsx`)

Pour ne pas recoder le bug à la main, réutiliser :

- `<AppText variant="title|body|muted|label">` — texte mappé sur les tokens.
- `<AppCard>` — surface (`bg-surface` + `text-foreground` + `border-border`).
- `<AppInput>` / `<SearchBar>` — champ thémé (fond, texte, placeholder, focus).
- `<AppButton variant="primary|secondary|ghost">` — bouton thémé.
- `<SheetSurface>` — surface de feuille (fixe `bg-` **et** `text-`, requis pour
  les Portals). La feuille Drive existante (`Sheet` de `drive-modals.tsx`) porte
  désormais aussi `text-[var(--d-ink)]` pour la même raison.

Tous personnalisables par props (taille, variante, icône…) sans jamais exposer
de couleur en dur.

## Garde-fou lint

`eslint.config.mjs` interdit (niveau `warn`, scopé aux espaces sombres) :
couleurs hex/rgb en style inline, classes arbitraires `bg-[#…]`/`text-[#…]`, et
`text-white/bg-white/...-black` en `className`. **Promouvoir en `error`** (+
`eslint --max-warnings 0` en CI) une fois la tokenisation des ~90 usages hérités
terminée.

## Checklist pour TOUT nouvel écran / composant

1. Uniquement des tokens de thème pour les couleurs (jamais de hex/white en dur).
2. Réutiliser les composants thémés (`AppInput`, `AppCard`, `SheetSurface`…).
3. **Tester en clair ET en sombre** avant livraison — aucun texte ne disparaît.
4. Viser un contraste lisible (WCAG AA) sur chaque paire texte/fond.
