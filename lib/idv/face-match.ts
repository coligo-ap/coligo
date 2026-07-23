// =============================================================================
// IDV — COMPARAISON DES VISAGES : gabarit d'identité + normalisation du score.
// Module PUR (aucune dépendance) : c'est ici que se décide la JUSTESSE, et ça
// se teste au banc, sans modèle ni réseau.
//
// ── 1. Comment on compare une SESSION de selfie à UN portrait ───────────────
//
// L'utilisateur ne donne pas une photo : il donne 3 frames (les défis de
// présence). L'ancienne production gardait « la meilleure » — le cosinus le plus
// haut. C'est une erreur de statistique : le maximum de N tirages monte AUSSI
// pour un imposteur (plus on tire, plus on finit par tomber sur une vue qui lui
// ressemble). On payait donc en sécurité ce qu'on croyait gagner en indulgence.
//
// Un système biométrique sérieux construit un GABARIT : il moyenne les
// embeddings des vues, puis compare une seule fois. Le bruit de capture (main
// qui tremble, exposition qui respire, compression) s'annule ; le visage, lui,
// reste. Mesuré sur le corpus réel (13 identités, photos différentes) :
//
//                    pire légitime   pire imposteur
//   une seule frame      0.322            0.366     ← les populations se croisent
//   « la meilleure »     0.372            0.374
//   GABARIT              0.365            0.370     ← et l'imposteur baisse
//
// Le gabarit relève le pire cas légitime (0.322 → 0.365 : plus personne
// d'honnête sous le seuil de refus) SANS relever l'imposteur.
//
// ── 2. Toutes les vues ne se valent pas ─────────────────────────────────────
//
// Une moyenne bête serait naïve : la frame « tournez la tête » sert à prouver
// qu'on est VIVANT, pas à dire QUI on est — de profil, un visage porte moins
// d'identité. On pondère donc chaque vue par ce qu'elle apporte vraiment
// (netteté × résolution × frontalité, cf. pipeline/face-quality.ts) : la frame
// de face domine, les autres complètent.
//
// ── 3. L'échelle des seuils ─────────────────────────────────────────────────
//
// SFace rend un cosinus ∈ [-1,1] ; les seuils du super-admin (idv_modes) vivent
// dans une échelle NORMALISÉE [0,1] — c'est ce qui permet de changer de modèle
// un jour sans invalider la configuration.
//
// Ancres CALIBRÉES sur le corpus réel (scripts/test-idv-calibration.mjs) :
//   • REFUS automatique sous le score 0.25  → cosinus 0.25
//     Le pire cas LÉGITIME mesuré est à 0.365 : on refuse donc bien au-dessous
//     de tout ce qu'une personne honnête peut produire. Un refus à tort est une
//     porte fermée à quelqu'un qui n'a rien fait ; le doute doit aller à la
//     revue humaine, jamais au refus.
//   • APPROBATION automatique dès le score 0.60 → cosinus 0.53
//     Le pire IMPOSTEUR mesuré est à 0.370 (sur des imposteurs difficiles : même
//     sexe, même morphologie). On approuve seulement 0.16 au-dessus : aucun
//     imposteur du corpus n'en approche.
//   • entre les deux : REVUE HUMAINE — la zone où la machine ne sait pas, et où
//     elle a le devoir de le dire.
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

/** Score normalisé → cosinus (lecture des seuils DB dans l'unité du modèle). */
export function faceScoreToCosine(score: number): number {
  return COS_FLOOR + score * (COS_CEIL - COS_FLOOR);
}

export type FaceView = {
  /** Embedding SFace L2-normalisé de la vue. */
  embedding: readonly number[];
  /** Poids ∈ ]0,1] — ce que la vue apporte à l'identité (face-quality.ts). */
  weight: number;
};

/**
 * GABARIT d'identité : moyenne pondérée des embeddings, re-normalisée L2.
 *
 * Re-normaliser est essentiel : la moyenne de vecteurs unitaires n'est plus
 * unitaire (elle se raccourcit d'autant plus que les vues divergent), et un
 * cosinus calculé sur un vecteur non unitaire ne veut plus rien dire.
 *
 * null = aucune vue exploitable (l'appelant enverra le dossier en revue plutôt
 * que d'inventer un score).
 */
export function buildFaceTemplate(views: readonly FaceView[]): number[] | null {
  const usable = views.filter((v) => v.weight > 0 && v.embedding.length > 0);
  if (usable.length === 0) return null;

  const dim = usable[0].embedding.length;
  const sum = new Array<number>(dim).fill(0);
  for (const view of usable) {
    if (view.embedding.length !== dim) continue;
    for (let i = 0; i < dim; i++) sum[i] += view.embedding[i] * view.weight;
  }

  let norm = 0;
  for (let i = 0; i < dim; i++) norm += sum[i] ** 2;
  norm = Math.sqrt(norm);
  if (norm === 0) return null;
  return sum.map((v) => v / norm);
}

/** Cosinus de deux vecteurs L2-normalisés. */
export function cosine(a: readonly number[], b: readonly number[]): number {
  if (a.length !== b.length || a.length === 0) return -1;
  let dot = 0;
  for (let i = 0; i < a.length; i++) dot += a[i] * b[i];
  return dot;
}
