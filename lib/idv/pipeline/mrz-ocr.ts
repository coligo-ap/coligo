import { join } from "node:path";
import sharp from "sharp";
import { createWorker, type Worker } from "tesseract.js";

// =============================================================================
// IDV — OCR de la ZONE MRZ (tesseract.js, tessdata AUTOHÉBERGÉE dans
// models/idv/tessdata — jamais de CDN au runtime). Whitelist stricte A-Z0-9<
// (approche PassportEye). Le worker se charge UNE fois par instance.
//
// Module AUTO-CONTENU (sharp + tesseract uniquement) : il sort du TEXTE brut
// par zone candidate ; le parsing + checksums (lib/idv/mrz.ts, pur) sont
// composés par l'appelant (route analyze-document, banc de test).
// =============================================================================

let workerPromise: Promise<Worker> | null = null;

export function getMrzWorker(): Promise<Worker> {
  if (!workerPromise) {
    workerPromise = (async () => {
      const worker = await createWorker("eng", 1, {
        langPath: join(process.cwd(), "models", "idv", "tessdata"),
        gzip: false,
        cacheMethod: "none",
      });
      await worker.setParameters({
        tessedit_char_whitelist: "ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789<",
        // Bloc de texte uniforme (les 2-3 lignes MRZ).
        tessedit_pageseg_mode: "6" as never,
        preserve_interword_spaces: "0",
      });
      return worker;
    })();
    workerPromise.catch(() => {
      workerPromise = null;
    });
  }
  return workerPromise;
}

export type MrzBand = { top: number; height: number } | null;

/** Zones candidates : la MRZ vit en bas du document — ~25 % (TD3, 2 lignes),
 *  ~40 % (TD1, 3 lignes) — puis repli sur l'image entière. */
export function mrzBands(format: "td1" | "td3"): MrzBand[] {
  return [
    format === "td3" ? { top: 0.7, height: 0.3 } : { top: 0.58, height: 0.42 },
    null,
  ];
}

/** Prépare une zone pour l'OCR : gris + largeur 1600, RIEN d'autre — mesuré
 *  au banc : normalise/sharpen DÉGRADENT la lecture tesseract (conf 43 → 0). */
async function prepare(image: Buffer, band: MrzBand): Promise<Buffer> {
  let img = sharp(image).rotate();
  if (band) {
    const meta = await img.metadata();
    const w = meta.width ?? 0;
    const h = meta.height ?? 0;
    if (w > 0 && h > 0) {
      img = img.extract({
        left: 0,
        top: Math.round(h * band.top),
        width: w,
        height: Math.round(h * band.height),
      });
    }
  }
  return img
    .grayscale()
    .resize({ width: 1600, withoutEnlargement: false })
    .png()
    .toBuffer();
}

/** OCR d'une zone candidate → texte brut (lignes séparées par \n). */
export async function ocrMrzBand(
  image: Buffer,
  band: MrzBand
): Promise<string> {
  const worker = await getMrzWorker();
  const prepared = await prepare(image, band);
  const { data } = await worker.recognize(prepared);
  return data.text;
}
