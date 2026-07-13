import sharp from "sharp";

// =============================================================================
// IDV — contrôle QUALITÉ serveur d'une photo de document (check `doc_quality`).
// Heuristiques classiques de netteté/exposition, calculées sur une version
// réduite en niveaux de gris :
//   • netteté   : variance du Laplacien (photo floue ⇒ variance faible) ;
//   • exposition: luminosité moyenne bornée (ni cave, ni cramée) ;
//   • reflets   : part de pixels saturés (flash/plastification) ;
//   • résolution: taille minimale du fichier décodé.
// Le client fait les MÊMES contrôles en direct pour guider la prise — mais
// seul CE verdict serveur fait foi (le client est falsifiable).
// Module auto-contenu → testé par scripts/test-idv-pipeline.mjs.
// =============================================================================

export type DocQualityReason =
  | "blurry"
  | "too_dark"
  | "too_bright"
  | "glare"
  | "low_resolution";

export const DOC_QUALITY_REASONS_FR: Record<DocQualityReason, string> = {
  blurry: "Photo floue — stabilisez et réessayez",
  too_dark: "Trop sombre — ajoutez de la lumière",
  too_bright: "Surexposée — éloignez la source de lumière",
  glare: "Reflets sur le document — inclinez-le légèrement",
  low_resolution: "Image trop petite — rapprochez-vous du document",
};

export type DocQuality = {
  verdict: "passed" | "failed";
  /** Score global ∈ [0,1] (min des sous-scores). */
  score: number;
  reasons: DocQualityReason[];
  metrics: {
    width: number;
    height: number;
    sharpness: number; // variance du Laplacien (grand = net)
    brightness: number; // moyenne 0-255
    glareRatio: number; // part de pixels ≥ 250
  };
};

// Seuils de CAPTURE (constants : c'est de la physique de photo, pas une
// politique produit — les seuils de DÉCISION, eux, vivent en DB).
const MIN_SIDE = 640;
const MIN_SHARPNESS = 60;
const GOOD_SHARPNESS = 250;
const BRIGHTNESS_RANGE: [number, number] = [50, 215];
const MAX_GLARE = 0.06;
/** Largeur d'analyse : la netteté est comparée à résolution CONSTANTE. */
const ANALYSIS_WIDTH = 800;

const clamp01 = (x: number) => Math.min(1, Math.max(0, x));

export async function assessDocQuality(input: Buffer): Promise<DocQuality> {
  const meta = await sharp(input).rotate().metadata();
  const width = meta.width ?? 0;
  const height = meta.height ?? 0;

  const { data, info } = await sharp(input)
    .rotate()
    .resize({ width: ANALYSIS_WIDTH, withoutEnlargement: true })
    .grayscale()
    .raw()
    .toBuffer({ resolveWithObject: true });
  const w = info.width;
  const h = info.height;

  // Luminosité + reflets.
  let sum = 0;
  let saturated = 0;
  for (let i = 0; i < data.length; i++) {
    sum += data[i];
    if (data[i] >= 250) saturated++;
  }
  const brightness = sum / data.length;
  const glareRatio = saturated / data.length;

  // Variance du Laplacien (noyau 4-voisins), bords exclus.
  let lapSum = 0;
  let lapSq = 0;
  const n = (w - 2) * (h - 2);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap =
        4 * data[i] - data[i - 1] - data[i + 1] - data[i - w] - data[i + w];
      lapSum += lap;
      lapSq += lap * lap;
    }
  }
  const mean = lapSum / n;
  const sharpness = lapSq / n - mean * mean;

  const reasons: DocQualityReason[] = [];
  if (Math.min(width, height) < MIN_SIDE) reasons.push("low_resolution");
  if (sharpness < MIN_SHARPNESS) reasons.push("blurry");
  if (brightness < BRIGHTNESS_RANGE[0]) reasons.push("too_dark");
  if (brightness > BRIGHTNESS_RANGE[1]) reasons.push("too_bright");
  if (glareRatio > MAX_GLARE) reasons.push("glare");

  const score = Math.min(
    clamp01(sharpness / GOOD_SHARPNESS),
    clamp01(
      1 -
        Math.max(
          0,
          BRIGHTNESS_RANGE[0] - brightness,
          brightness - BRIGHTNESS_RANGE[1]
        ) /
          60
    ),
    clamp01(1 - glareRatio / (MAX_GLARE * 3)),
    Math.min(width, height) >= MIN_SIDE ? 1 : 0.3
  );

  return {
    verdict: reasons.length === 0 ? "passed" : "failed",
    score: Math.round(score * 1000) / 1000,
    reasons,
    metrics: {
      width,
      height,
      sharpness: Math.round(sharpness),
      brightness: Math.round(brightness),
      glareRatio: Math.round(glareRatio * 1000) / 1000,
    },
  };
}
