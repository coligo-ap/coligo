// =============================================================================
// Assets de marque — POINT UNIQUE de vérité pour tous les logos de l'app.
// =============================================================================
// Tous les fichiers sont GÉNÉRÉS par `node scripts/brand-assets.mjs` à partir
// des sources `public/logo-coligo-*.png`. Pour changer de logo :
//   1. déposer les nouvelles sources dans public/,
//   2. relancer `node scripts/brand-assets.mjs` puis `node scripts/ios-splash.mjs`,
//   3. rien d'autre — tous les composants importent les chemins ci-dessous.
//
// Conventions :
//   - `full*`  : logo COMPLET FR + AR (logo par défaut de la marque) ;
//   - `fr*`/`ar*` : wordmark seul (lockups type « Coligo Drive ») ;
//   - `*White` : version blanche (fonds sombres / violets / dark mode) ;
//   - `iconC*` : le « C » seul (tuiles, favicons, petits espaces) ;
//   - `print`  : version NOIRE pour tickets thermiques (encre noire).
// =============================================================================

export const BRAND_ASSETS = {
  full: "/brand/logo-full.png",
  fullWhite: "/brand/logo-full-white.png",
  fr: "/brand/logo-fr.png",
  frWhite: "/brand/logo-fr-white.png",
  ar: "/brand/logo-ar.png",
  arWhite: "/brand/logo-ar-white.png",
  iconC: "/brand/icon-c.png",
  iconCWhite: "/brand/icon-c-white.png",
  print: "/brand/logo-print.png",
} as const;

/** Ratios largeur/hauteur réels des fichiers générés (pour width/height). */
export const BRAND_RATIOS = {
  full: 1000 / 401,
  fr: 800 / 275,
} as const;
