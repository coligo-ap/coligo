import sharp from "sharp";

// =============================================================================
// IDV — décodage image serveur (sharp). Sort du RGB brut interleavé, orienté
// selon l'EXIF (les photos téléphone arrivent souvent « couchées »), bridé en
// taille pour borner CPU/mémoire.
// =============================================================================

export type RawImage = {
  /** Pixels RGB interleavés (r,g,b,r,g,b,…), SANS alpha. */
  data: Uint8Array;
  width: number;
  height: number;
};

export async function decodeImage(
  input: Buffer | Uint8Array,
  maxSide = 1280
): Promise<RawImage> {
  const { data, info } = await sharp(input, { limitInputPixels: 30_000_000 })
    .rotate() // applique l'orientation EXIF
    .resize({
      width: maxSide,
      height: maxSide,
      fit: "inside",
      withoutEnlargement: true,
    })
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });

  if (info.channels === 3) {
    return { data, width: info.width, height: info.height };
  }
  // Image en niveaux de gris (1 canal) : expansion manuelle vers RGB.
  const rgb = new Uint8Array(info.width * info.height * 3);
  for (let i = 0; i < info.width * info.height; i++) {
    const v = data[i * info.channels];
    rgb[i * 3] = v;
    rgb[i * 3 + 1] = v;
    rgb[i * 3 + 2] = v;
  }
  return { data: rgb, width: info.width, height: info.height };
}

/** Recadre une zone (clampée à l'image) puis la redimensionne en carré
 *  `size`×`size` — utilisé pour préparer l'entrée 112×112 de SFace. */
export async function cropResize(
  raw: RawImage,
  box: { x: number; y: number; w: number; h: number },
  size: number
): Promise<RawImage> {
  const left = Math.max(0, Math.round(box.x));
  const top = Math.max(0, Math.round(box.y));
  const width = Math.min(raw.width - left, Math.round(box.w));
  const height = Math.min(raw.height - top, Math.round(box.h));
  if (width <= 1 || height <= 1) {
    throw new Error("cropResize : zone hors image");
  }
  const { data, info } = await sharp(raw.data, {
    raw: { width: raw.width, height: raw.height, channels: 3 },
  })
    .extract({ left, top, width, height })
    .resize(size, size, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/**
 * VARIANTE « détection » : redresse le contraste et éclaircit les basses
 * lumières. Une photo prise le soir, dans une voiture, ou avec un capteur bon
 * marché sort sous-exposée et plate — YuNet y rate des visages qu'il trouve
 * sans peine une fois l'image normalisée. On ne s'en sert QUE pour détecter :
 * l'embedding, lui, se calcule toujours sur les pixels d'origine (une image
 * « retouchée » déplacerait le visage dans l'espace du modèle).
 */
export async function enhanceForDetection(raw: RawImage): Promise<RawImage> {
  const { data, info } = await sharp(raw.data, {
    raw: { width: raw.width, height: raw.height, channels: 3 },
  })
    .normalise() // étire l'histogramme (contraste)
    .gamma(1.2) // relève les ombres sans cramer les hautes lumières
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** Agrandissement (Lanczos) — un portrait de passeport fait parfois 90 px de
 *  côté sur la photo reçue : sous ~40 px, YuNet ne voit plus rien. */
export async function upscale(raw: RawImage, factor = 2): Promise<RawImage> {
  const { data, info } = await sharp(raw.data, {
    raw: { width: raw.width, height: raw.height, channels: 3 },
  })
    .resize({
      width: Math.round(raw.width * factor),
      height: Math.round(raw.height * factor),
      kernel: "lanczos3",
    })
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}

/** Rotation par quart de tour — certaines caméras (et certains utilisateurs)
 *  envoient le document couché, sans EXIF pour le dire. */
export async function rotateRaw(
  raw: RawImage,
  angle: 90 | 180 | 270
): Promise<RawImage> {
  const { data, info } = await sharp(raw.data, {
    raw: { width: raw.width, height: raw.height, channels: 3 },
  })
    .rotate(angle)
    .raw()
    .toBuffer({ resolveWithObject: true });
  return { data, width: info.width, height: info.height };
}
