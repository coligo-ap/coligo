import { join } from "node:path";
import sharp from "sharp";
import { createWorker, type Worker } from "tesseract.js";

// =============================================================================
// IDV — OCR de la ZONE MRZ (tesseract.js, tessdata AUTOHÉBERGÉE dans
// models/idv/tessdata — jamais de CDN au runtime). Whitelist stricte A-Z0-9<.
// Le worker se charge UNE fois par instance.
//
// Stratégie MULTI-PASSES (calibrée sur cartes réelles, test E2E) : on essaie
// plusieurs zones (bande basse puis image entière) × plusieurs prétraitements,
// et on S'ARRÊTE dès qu'une MRZ aux checksums VALIDES sort. Sinon on garde la
// meilleure lecture (score de checksums le plus haut) pour le diagnostic.
//
// PIÈGES mesurés :
//   • une photo de carte est un JPEG : sans BINARISATION, tesseract confond
//     tout (« D231458907 » lu « DZ3VA5O904 ») — le seuillage change tout ;
//   • normalise()/sharpen() DÉGRADENT au contraire une image déjà propre ;
//   • plus grand n'est pas toujours mieux : 1600 px suffit sur une bande nette,
//     2400-3000 px + seuil est ce qui sauve les photos compressées.
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
/** Format MRZ attendu (dupliqué ici pour garder ce module SANS dépendance :
 *  il est importé par le banc Node, qui ne résout pas les imports relatifs
 *  sans extension). Le parseur est INJECTÉ par l'appelant. */
export type MrzOcrFormat = "td1" | "td3";

/** Zones candidates : la MRZ vit en bas du document — ~30 % (TD3, 2 lignes),
 *  ~42 % (TD1, 3 lignes) — puis repli sur l'image entière. */
export function mrzBands(format: MrzOcrFormat): MrzBand[] {
  return [
    format === "td3" ? { top: 0.7, height: 0.3 } : { top: 0.58, height: 0.42 },
    null,
  ];
}

/** Prétraitements essayés dans l'ordre (du plus fréquent au plus agressif). */
type Preprocess = { label: string; width: number; threshold: number | null };

const PREPROCESS: Preprocess[] = [
  // Photo compressée (le cas réel) : agrandir puis BINARISER.
  { label: "2400+seuil", width: 2400, threshold: 150 },
  { label: "3000+seuil", width: 3000, threshold: 160 },
  // Image déjà nette (scan, capture propre) : ne rien abîmer.
  { label: "1600-brut", width: 1600, threshold: null },
];

async function prepare(
  image: Buffer,
  band: MrzBand,
  pp: Preprocess
): Promise<Buffer> {
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
  img = img.grayscale().resize({ width: pp.width, withoutEnlargement: false });
  if (pp.threshold !== null) img = img.threshold(pp.threshold);
  return img.png().toBuffer();
}

/** OCR d'une zone candidate avec un prétraitement donné → texte brut. */
export async function ocrMrzBand(
  image: Buffer,
  band: MrzBand,
  preprocess: Preprocess = PREPROCESS[0]
): Promise<string> {
  const worker = await getMrzWorker();
  const prepared = await prepare(image, band, preprocess);
  const { data } = await worker.recognize(prepared);
  return data.text;
}

/** Résultat minimal attendu du parseur injecté (lib/idv/mrz.ts). */
type ParsedLike = { valid: boolean; score: number };

export type MrzReadResult<P extends ParsedLike> = {
  /** null = aucune structure MRZ reconnaissable sur toutes les passes. */
  parsed: P | null;
  /** Passe qui a produit le résultat retenu (diagnostic). */
  attempt: string | null;
  rawText: string;
};

/**
 * Lit la MRZ : toutes les zones × tous les prétraitements, sortie ANTICIPÉE
 * dès que les checksums sont valides. Le meilleur résultat partiel est
 * conservé (utile à l'admin en revue : « MRZ lue mais checksums KO » ≠
 * « MRZ illisible »).
 */
export async function readMrz<P extends ParsedLike>(
  image: Buffer,
  format: MrzOcrFormat,
  /** Parseur MRZ (lib/idv/mrz.ts `parseMrz`) — injecté pour garder ce module
   *  autonome. */
  parse: (lines: string[]) => P | null
): Promise<MrzReadResult<P>> {
  let best: MrzReadResult<P> = { parsed: null, attempt: null, rawText: "" };
  for (const band of mrzBands(format)) {
    for (const pp of PREPROCESS) {
      const label = `${band ? "bande" : "pleine"}/${pp.label}`;
      const rawText = await ocrMrzBand(image, band, pp);
      const parsed = parse(rawText.split(/\r?\n/));
      if (parsed?.valid) return { parsed, attempt: label, rawText };
      if (parsed && (!best.parsed || parsed.score > best.parsed.score)) {
        best = { parsed, attempt: label, rawText };
      }
      if (!best.rawText) best = { ...best, rawText };
    }
  }
  return best;
}

// ── OCR GÉNÉRALISTE (permis : zone visuelle, pas de MRZ — étape 5b) ─────────
// Worker distinct : langue FRANÇAISE et AUCUNE whitelist (on lit du texte, pas
// de l'OCR-B). tessdata fra autohébergée (Apache-2.0).

let frWorkerPromise: Promise<Worker> | null = null;

function getVisualWorker(): Promise<Worker> {
  if (!frWorkerPromise) {
    frWorkerPromise = (async () => {
      const worker = await createWorker("fra", 1, {
        langPath: join(process.cwd(), "models", "idv", "tessdata"),
        gzip: false,
        cacheMethod: "none",
      });
      // Page entière, texte libre : pas de whitelist (on perdrait les dates).
      await worker.setParameters({
        tessedit_pageseg_mode: "3" as never,
      });
      return worker;
    })();
    frWorkerPromise.catch(() => {
      frWorkerPromise = null;
    });
  }
  return frWorkerPromise;
}

/** Termine les workers (tests : sinon le process Node ne se ferme jamais). */
export async function terminateOcrWorkers(): Promise<void> {
  if (workerPromise) await (await workerPromise).terminate();
  if (frWorkerPromise) await (await frWorkerPromise).terminate();
  workerPromise = null;
  frWorkerPromise = null;
}

/**
 * OCR de la zone visuelle d'un document (permis). Deux passes : image nette
 * agrandie, puis binarisée — on retient le texte le plus riche en dates.
 */
export async function ocrVisualZone(image: Buffer): Promise<string> {
  const worker = await getVisualWorker();
  const variants: (number | null)[] = [null, 160];
  let best = "";
  let bestDates = -1;
  for (const threshold of variants) {
    let img = sharp(image).rotate().grayscale().resize({ width: 2000 });
    if (threshold !== null) img = img.threshold(threshold);
    const { data } = await worker.recognize(await img.png().toBuffer());
    const dates = (data.text.match(/\d{2}[/.\-\s]\d{2}[/.\-\s]\d{4}/g) ?? [])
      .length;
    if (dates > bestDates) {
      bestDates = dates;
      best = data.text;
    }
    if (dates >= 2) break; // assez pour naissance + expiration
  }
  return best;
}
