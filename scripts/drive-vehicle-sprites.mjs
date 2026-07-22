/**
 * Normalise les visuels de véhicule Drive en SPRITES DE CARTE.
 *
 *   node scripts/drive-vehicle-sprites.mjs [dossier-source]
 *
 * CONVENTION UNIQUE : tout sprite sort NEZ VERS LE HAUT (cap 0° = nord). La
 * carte applique ensuite `rotate(cap)` — sans convention commune, une voiture
 * et une moto ne pointeraient pas dans la même direction pour un même cap.
 *
 * Les fichiers fournis n'avaient PAS la même orientation :
 *   - violet  : 794×392, nez à GAUCHE (ouest) → rotation +90°
 *   - blanc   : 393×792, nez en HAUT          → aucune rotation
 * Cette table est donc explicite, et non devinée à l'exécution.
 */
import { existsSync, mkdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import sharp from "sharp";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const SRC = process.argv[2] ?? "C:/Users/gaci/Downloads";
const OUT = join(ROOT, "public", "drive", "vehicles");

/** Hauteur du sprite exporté (2× la taille d'affichage max ≈ 56 px). */
const H = 224;

const SPRITES = [
  {
    src: "voiture-coligo-violet.png",
    out: "voiture-coligo-violet.png",
    rotate: 90,
  },
  { src: "motocoligo-violet.png", out: "moto-coligo-violet.png", rotate: 90 },
  {
    src: "voiture-coligo-white.png",
    out: "voiture-coligo-white.png",
    rotate: 0,
  },
  { src: "moto-coligo-white.png", out: "moto-coligo-white.png", rotate: 0 },
];

mkdirSync(OUT, { recursive: true });

for (const s of SPRITES) {
  const from = join(SRC, s.src);
  if (!existsSync(from)) {
    console.warn(`⚠ introuvable : ${from}`);
    continue;
  }
  const img = sharp(from).rotate(s.rotate, {
    background: { r: 0, g: 0, b: 0, alpha: 0 },
  });
  // `trim` retire la marge transparente : le sprite tourne alors autour de son
  // CENTRE RÉEL (sinon le véhicule « orbite » quand le cap change).
  const buf = await img
    .trim({ threshold: 1 })
    .resize({ height: H, fit: "inside", withoutEnlargement: false })
    .png({ compressionLevel: 9, palette: true })
    .toBuffer();
  const dest = join(OUT, s.out);
  await sharp(buf).toFile(dest);
  const m = await sharp(dest).metadata();
  console.log(`✅ ${s.out} — ${m.width}×${m.height} (rotation ${s.rotate}°)`);
}
console.log(`\nSprites dans ${OUT}`);
