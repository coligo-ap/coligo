// =============================================================================
// IDV — NORMALISATION du score de comparaison de visages (module pur).
//
// SFace produit un cosinus ∈ [-1,1] ; les seuils du super-admin (idv_modes)
// vivent, eux, dans une échelle NORMALISÉE [0,1] — c'est ce qui permet de
// changer de modèle sans invalider la configuration.
//
// Ancres CALIBRÉES sur mesures réelles (14/07/2026), pipeline ALIGNÉ (recalage
// 5 points + moyenne miroir — lib/idv/pipeline/align.ts). Dégradations jouées :
// selfie sombre, flou de bougé, incliné 12°, petit + JPEG 35 (réseau 3G),
// portrait de passeport 150 px q45, portrait imprimé 100 px.
//   • MÊME personne .......... cosinus 0.653 (pire cas) → 0.845 (moyenne) → 1
//   • personne DIFFÉRENTE .... cosinus 0.010 → 0.210 (pire cas)
//   • marge de séparation .... 0.443  (elle valait 0.239 SANS alignement)
//
// Le recalage a doublé cette marge : un selfie penché de 12° passait de 0.556 à
// 0.930, un portrait imprimé de 100 px de 0.456 à 0.653.
//
// Choix des ancres (0.05 / 0.85), avec les seuils par défaut 0.35 (refus) et
// 0.60 (approbation) :
//   • le REFUS automatique tombe à cos ≈ 0.33 — juste SOUS la frontière
//     « même identité » d'OpenCV pour SFace (0.363) : on ne refuse jamais
//     automatiquement quelqu'un qu'OpenCV considérerait comme reconnu ;
//   • l'APPROBATION automatique exige cos ≥ 0.53, bien AU-DESSUS de cette
//     frontière : conservateur par construction ;
//   • entre les deux (cos 0.33-0.53) : revue humaine.
// Résultat sur les mesures : imposteurs ≤ 0.24 (refus auto), même personne
// ≥ 0.75 (approbation auto) — la zone de revue reste pour les cas réellement
// douteux. Le banc rejoue ces mesures (scripts/test-idv-pipeline.mjs) : toute
// dérive du modèle ou du pré-traitement casse le test.
// =============================================================================

/** Cosinus au-dessous duquel le score normalisé vaut 0. */
export const COS_FLOOR = 0.05;
/** Cosinus à partir duquel le score normalisé vaut 1. */
export const COS_CEIL = 0.85;

/** Cosinus SFace → score normalisé [0,1], comparable aux seuils DB. */
export function normalizeFaceScore(cosine: number): number {
  const x = (cosine - COS_FLOOR) / (COS_CEIL - COS_FLOOR);
  const clamped = Math.min(1, Math.max(0, x));
  return Math.round(clamped * 1000) / 1000;
}
