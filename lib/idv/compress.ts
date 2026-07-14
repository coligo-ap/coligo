// =============================================================================
// IDV — COMPRESSION ADAPTATIVE des captures, côté navigateur.
//
// Le problème est concret : une caméra moderne rend un recto de document de 2 à
// 3 Mo en JPEG. Sur une 3G algérienne à 200 ko/s, c'est 15 secondes d'envoi —
// et un envoi long est un envoi qui échoue (l'utilisateur verrouille l'écran,
// le réseau change de cellule). Or ces méga-octets ne servent à rien : le
// serveur ne lit la bande MRZ qu'après l'avoir ré-agrandie, et le visage tient
// dans 112 pixels.
//
// On vise donc un BUDGET d'octets, atteint en baissant d'abord la qualité JPEG,
// puis la définition — mais jamais sous un plancher qui rendrait le document
// illisible. Ce qui compte n'est pas « la plus belle image », c'est « la plus
// petite image encore lisible par la machine ».
// =============================================================================

export type CompressTarget = {
  /** Plus grand côté toléré au départ. */
  maxSide: number;
  /** Plancher de définition : en dessous, on renonce à compresser davantage. */
  minSide: number;
  /** Budget visé, en octets. */
  maxBytes: number;
  /** Qualité JPEG de départ, puis plancher. */
  quality: number;
  minQuality: number;
};

/** Document : la bande MRZ doit rester lisible après ré-agrandissement serveur. */
export const DOC_TARGET: CompressTarget = {
  maxSide: 1800,
  minSide: 1200,
  maxBytes: 900_000,
  quality: 0.9,
  minQuality: 0.62,
};

/** Selfie : seul le visage compte — 720 px est déjà généreux pour un modèle
 *  qui travaille en 112×112. */
export const SELFIE_TARGET: CompressTarget = {
  maxSide: 720,
  minSide: 480,
  maxBytes: 220_000,
  quality: 0.86,
  minQuality: 0.6,
};

async function encode(
  bitmap: ImageBitmap,
  side: number,
  quality: number
): Promise<Blob | null> {
  const scale = Math.min(1, side / Math.max(bitmap.width, bitmap.height));
  const w = Math.max(1, Math.round(bitmap.width * scale));
  const h = Math.max(1, Math.round(bitmap.height * scale));
  const canvas = document.createElement("canvas");
  canvas.width = w;
  canvas.height = h;
  const ctx = canvas.getContext("2d");
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, w, h);
  return new Promise((resolve) =>
    canvas.toBlob((b) => resolve(b), "image/jpeg", quality)
  );
}

/**
 * Ramène une capture sous le budget d'octets. Toute erreur (canvas indisponible,
 * image exotique) renvoie le fichier D'ORIGINE : mieux vaut un envoi lourd qu'un
 * dossier perdu — la vérification passe avant l'optimisation.
 */
export async function compressCapture(
  blob: Blob,
  target: CompressTarget
): Promise<Blob> {
  try {
    if (blob.size <= target.maxBytes && blob.type === "image/jpeg") {
      // Déjà léger : on ne le ré-encode pas (ré-encoder, c'est perdre du détail
      // pour rien).
      return blob;
    }
    const bitmap = await createImageBitmap(blob);
    let side = target.maxSide;
    let quality = target.quality;
    let best: Blob | null = null;

    // On baisse d'abord la QUALITÉ (invisible pour un OCR), puis la DÉFINITION.
    for (let i = 0; i < 6; i++) {
      const out = await encode(bitmap, side, quality);
      if (!out) break;
      best = out;
      if (out.size <= target.maxBytes) break;
      if (quality > target.minQuality) {
        quality = Math.max(target.minQuality, quality - 0.1);
      } else if (side > target.minSide) {
        side = Math.max(target.minSide, Math.round(side * 0.85));
      } else {
        break; // plancher atteint : on garde la dernière version lisible
      }
    }
    bitmap.close();
    return best && best.size < blob.size ? best : blob;
  } catch {
    return blob;
  }
}
