// =============================================================================
// IDV — ALIGNEMENT du visage sur le gabarit 5 points (ArcFace/SFace).
//
// POURQUOI. SFace n'a pas été entraîné sur des « boîtes de visage » : il a été
// entraîné sur des visages RECALÉS — yeux, nez et bouche ramenés à des positions
// canoniques dans un carré 112×112. Lui donner un simple recadrage de la boîte
// (ce que faisait le pipeline jusqu'ici), c'est lui présenter des visages
// tournés, décentrés, de cadrage variable : le même visage produit alors des
// embeddings différents selon l'angle de la tête ou la façon dont la photo a été
// prise. C'est exactement le cas de figure de notre métier : un portrait de
// passeport bien cadré, face à un selfie pris à bout de bras, de biais, penché.
//
// L'alignement supprime cette variation : rotation, échelle et translation sont
// ré-estimées à partir des 5 repères de YuNet, puis appliquées à l'image. Le
// modèle ne voit plus que ce qui distingue vraiment deux personnes.
//
// Gabarit officiel (OpenCV FaceRecognizerSF::alignCrop, insightface arcface_src)
// pour une sortie 112×112, dans l'ORDRE des repères YuNet :
//   œil droit, œil gauche, nez, coin droit de la bouche, coin gauche.
//
// Le warp est fait ici en JS pur (échantillonnage bilinéaire) : 112×112 = 12 544
// pixels, coût négligeable, et aucune dépendance de plus.
// =============================================================================

export type RawLike = { data: Uint8Array; width: number; height: number };

export const ALIGN_SIZE = 112;

/** Positions canoniques des 5 repères pour une sortie 112×112. */
export const SFACE_TEMPLATE: readonly [number, number][] = [
  [38.2946, 51.6963], // œil droit
  [73.5318, 51.5014], // œil gauche
  [56.0252, 71.7366], // nez
  [41.5493, 92.3655], // bouche droite
  [70.7299, 92.2041], // bouche gauche
];

type Similarity = {
  /** [[a, -b], [b, a]] · p + [tx, ty] — rotation + échelle uniforme. */
  a: number;
  b: number;
  tx: number;
  ty: number;
};

/**
 * Transformation de SIMILITUDE au sens des moindres carrés (Umeyama) qui
 * envoie `src` sur `dst`. Rotation + échelle + translation, sans cisaillement :
 * un visage reste un visage, on ne l'étire pas pour le faire coller au gabarit.
 */
export function estimateSimilarity(
  src: readonly [number, number][],
  dst: readonly [number, number][]
): Similarity {
  const n = Math.min(src.length, dst.length);
  if (n < 2) throw new Error("estimateSimilarity : au moins 2 points requis");

  let mxs = 0;
  let mys = 0;
  let mxd = 0;
  let myd = 0;
  for (let i = 0; i < n; i++) {
    mxs += src[i][0];
    mys += src[i][1];
    mxd += dst[i][0];
    myd += dst[i][1];
  }
  mxs /= n;
  mys /= n;
  mxd /= n;
  myd /= n;

  // Somme des produits croisés (a) et des « produits en croix » (b), plus la
  // variance de la source : c'est la solution fermée de la similitude 2D.
  let sa = 0;
  let sb = 0;
  let varSrc = 0;
  for (let i = 0; i < n; i++) {
    const sx = src[i][0] - mxs;
    const sy = src[i][1] - mys;
    const dx = dst[i][0] - mxd;
    const dy = dst[i][1] - myd;
    sa += sx * dx + sy * dy;
    sb += sx * dy - sy * dx;
    varSrc += sx * sx + sy * sy;
  }
  if (varSrc < 1e-8) throw new Error("estimateSimilarity : points dégénérés");

  const a = sa / varSrc;
  const b = sb / varSrc;
  return {
    a,
    b,
    tx: mxd - (a * mxs - b * mys),
    ty: myd - (b * mxs + a * mys),
  };
}

/** Échantillonnage bilinéaire d'un pixel RGB (bords répliqués). */
function sample(
  img: RawLike,
  x: number,
  y: number,
  out: Uint8Array,
  o: number
): void {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const fx = x - x0;
  const fy = y - y0;
  const cx0 = Math.min(img.width - 1, Math.max(0, x0));
  const cy0 = Math.min(img.height - 1, Math.max(0, y0));
  const cx1 = Math.min(img.width - 1, Math.max(0, x0 + 1));
  const cy1 = Math.min(img.height - 1, Math.max(0, y0 + 1));

  const i00 = (cy0 * img.width + cx0) * 3;
  const i10 = (cy0 * img.width + cx1) * 3;
  const i01 = (cy1 * img.width + cx0) * 3;
  const i11 = (cy1 * img.width + cx1) * 3;

  for (let c = 0; c < 3; c++) {
    const top = img.data[i00 + c] * (1 - fx) + img.data[i10 + c] * fx;
    const bottom = img.data[i01 + c] * (1 - fx) + img.data[i11 + c] * fx;
    out[o + c] = Math.round(top * (1 - fy) + bottom * fy);
  }
}

/**
 * Visage RECALÉ sur le gabarit, en 112×112 RGB.
 *
 * On calcule la similitude image → gabarit, puis on la PARCOURT À L'ENVERS :
 * pour chaque pixel de sortie on va chercher son antécédent dans l'image
 * source (interpolation bilinéaire). C'est ce qui évite les trous qu'un
 * parcours direct laisserait quand on agrandit un petit portrait.
 */
export function alignFace(
  image: RawLike,
  landmarks: readonly [number, number][],
  size: number = ALIGN_SIZE
): RawLike {
  const scale = size / ALIGN_SIZE;
  const template = SFACE_TEMPLATE.map(
    ([x, y]) => [x * scale, y * scale] as [number, number]
  );
  const { a, b, tx, ty } = estimateSimilarity(landmarks.slice(0, 5), template);

  // Inverse d'une similitude : det = a² + b², rotation opposée, même échelle.
  const det = a * a + b * b;
  if (det < 1e-12) throw new Error("alignFace : transformation dégénérée");
  const ia = a / det;
  const ib = -b / det;

  const out = new Uint8Array(size * size * 3);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const dx = x - tx;
      const dy = y - ty;
      const sx = ia * dx - ib * dy;
      const sy = ib * dx + ia * dy;
      sample(image, sx, sy, out, (y * size + x) * 3);
    }
  }
  return { data: out, width: size, height: size };
}

/** Miroir horizontal — sert à la moyenne d'embeddings (voir face-embed.ts). */
export function mirrorImage(image: RawLike): RawLike {
  const { width, height, data } = image;
  const out = new Uint8Array(data.length);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const src = (y * width + x) * 3;
      const dst = (y * width + (width - 1 - x)) * 3;
      out[dst] = data[src];
      out[dst + 1] = data[src + 1];
      out[dst + 2] = data[src + 2];
    }
  }
  return { data: out, width, height };
}
