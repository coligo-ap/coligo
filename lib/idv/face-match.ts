// =============================================================================
// IDV — NORMALISATION du score de comparaison de visages (module pur).
//
// SFace produit un cosinus ∈ [-1,1] ; les seuils du super-admin (idv_modes)
// vivent, eux, dans une échelle NORMALISÉE [0,1] — c'est ce qui permet de
// changer de modèle sans invalider la configuration.
//
// Ancres CALIBRÉES sur mesures réelles (13/07/2026), crops NON alignés
// (bbox YuNet) — le cas exact de notre pipeline :
//   • personnes DIFFÉRENTES ............... cosinus 0.166 / 0.187
//   • MÊME personne, portrait « carte » dégradé (180 px, JPEG q55) ↔ selfie
//     ....................................... cosinus 0.766
//   • MÊME personne, portrait tramé + incliné 6° ↔ selfie ... cosinus 0.742
//   • MÊME personne, même photo ............ cosinus 0.980
// Avec ces ancres : les imposteurs tombent à ~0.03-0.07 (REFUS auto sous
// 0.35), la même personne monte à ~1 (APPROBATION auto au-dessus de 0.60).
// Référence externe : OpenCV donne 0.363 comme frontière « même identité »
// pour SFace → ici ≈ 0.39 normalisé, soit DANS la zone de revue humaine :
// on n'approuve automatiquement qu'AU-DESSUS du seuil de confiance d'OpenCV
// (cos ≥ 0.48 pour un score de 0.60). Conservateur par construction.
// Le banc rejoue ces mesures (scripts/test-idv-pipeline.mjs) : toute dérive
// du modèle ou du pré-traitement casse le test.
// =============================================================================

/** Cosinus au-dessous duquel le score normalisé vaut 0. */
export const COS_FLOOR = 0.15;
/** Cosinus à partir duquel le score normalisé vaut 1. */
export const COS_CEIL = 0.7;

/** Cosinus SFace → score normalisé [0,1], comparable aux seuils DB. */
export function normalizeFaceScore(cosine: number): number {
  const x = (cosine - COS_FLOOR) / (COS_CEIL - COS_FLOOR);
  const clamped = Math.min(1, Math.max(0, x));
  return Math.round(clamped * 1000) / 1000;
}
