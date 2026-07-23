// =============================================================================
// Mesure des grandeurs de QUALITÉ D'UN VISAGE sur le corpus réel — pour fixer
// des seuils sur des NOMBRES, pas sur une intuition.
//
// On mesure, sur le visage RECALÉ (112×112, ce que voit vraiment SFace) :
//   • la netteté (variance du Laplacien) d'un visage net, flou, très flou ;
//   • l'écart inter-yeux en pixels natifs (résolution biométrique) ;
//   • la luminosité du visage sous/sur-exposé ;
//   • l'effet de chaque dégradation sur le COSINUS de reconnaissance — c'est ça
//     qui dit à partir de quand une capture n'est plus exploitable.
//
//   node --experimental-strip-types --import ./scripts/_alias.mjs scripts/idv-measure-quality.mjs
// =============================================================================
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { getIdvSession } from "../lib/idv/pipeline/onnx.ts";
import { decodeImage } from "../lib/idv/pipeline/image.ts";
import { cosineSimilarity } from "../lib/idv/pipeline/sface.ts";
import {
  findFaceUpright,
  embedFoundFace,
} from "../lib/idv/pipeline/face-embed.ts";
import { alignFace, ALIGN_SIZE } from "../lib/idv/pipeline/align.ts";

const MANIFEST = join(tmpdir(), "coligo-idv-corpus", "manifest.json");
if (!existsSync(MANIFEST)) {
  console.error("❌ Corpus absent — lancer scripts/idv-corpus.mjs");
  process.exit(1);
}
const { identities } = JSON.parse(readFileSync(MANIFEST, "utf8"));

const { session: yunet } = await getIdvSession("yunet");
const { session: sface } = await getIdvSession("sface");

/** Netteté (variance du Laplacien) et luminosité du CROP RECALÉ en gris. */
function faceMetrics(crop) {
  const n = crop.width * crop.height;
  const gray = new Float32Array(n);
  for (let i = 0; i < n; i++) {
    gray[i] =
      0.299 * crop.data[i * 3] +
      0.587 * crop.data[i * 3 + 1] +
      0.114 * crop.data[i * 3 + 2];
  }
  let sum = 0;
  for (let i = 0; i < n; i++) sum += gray[i];
  const brightness = sum / n;

  const w = crop.width;
  const h = crop.height;
  let lapSum = 0;
  let lapSq = 0;
  const count = (w - 2) * (h - 2);
  for (let y = 1; y < h - 1; y++) {
    for (let x = 1; x < w - 1; x++) {
      const i = y * w + x;
      const lap =
        4 * gray[i] - gray[i - 1] - gray[i + 1] - gray[i - w] - gray[i + w];
      lapSum += lap;
      lapSq += lap * lap;
    }
  }
  const mean = lapSum / count;
  return { sharpness: lapSq / count - mean * mean, brightness };
}

async function analyse(buf) {
  const img = await decodeImage(buf, 960); // même taille que la route selfie
  const found = await findFaceUpright(yunet, img);
  if (!found) return null;
  const { face } = found;
  const [eyeR, eyeL] = face.landmarks;
  const eyeDist = Math.hypot(eyeL[0] - eyeR[0], eyeL[1] - eyeR[1]);
  const crop = alignFace(img, face.landmarks, ALIGN_SIZE);
  const embedding = await embedFoundFace(sface, {
    image: img,
    face,
    pass: found.pass,
  });
  return { ...faceMetrics(crop), eyeDist, embedding, face };
}

const VARIANTS = {
  "net (référence)": (s) => s.jpeg({ quality: 92 }),
  "flou léger": (s) => s.blur(1.5).jpeg({ quality: 85 }),
  "flou net-": (s) => s.blur(3).jpeg({ quality: 85 }),
  "flou fort": (s) => s.blur(6).jpeg({ quality: 85 }),
  sombre: (s) => s.modulate({ brightness: 0.45 }).jpeg({ quality: 85 }),
  "très sombre": (s) => s.modulate({ brightness: 0.28 }).jpeg({ quality: 85 }),
  surexposé: (s) => s.modulate({ brightness: 1.7 }).jpeg({ quality: 85 }),
  "petit (visage 2×+ loin)": (s) =>
    s.resize({ width: 420 }).jpeg({ quality: 80 }),
  "très petit": (s) => s.resize({ width: 240 }).jpeg({ quality: 75 }),
  "jpeg 3G": (s) => s.jpeg({ quality: 25 }),
};

const rows = {};
for (const name of Object.keys(VARIANTS)) rows[name] = [];

for (const id of identities) {
  const file = id.photos[0].file;
  const src = readFileSync(file);
  const ref = await analyse(await sharp(src).jpeg({ quality: 92 }).toBuffer());
  if (!ref) continue;

  for (const [name, transform] of Object.entries(VARIANTS)) {
    const buf = await transform(sharp(src)).toBuffer();
    const m = await analyse(buf);
    if (!m) {
      rows[name].push({ lost: true });
      continue;
    }
    rows[name].push({
      sharpness: m.sharpness,
      brightness: m.brightness,
      eyeDist: m.eyeDist,
      cos: cosineSimilarity(ref.embedding, m.embedding),
    });
  }
}

const med = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length ? s[Math.floor(s.length / 2)] : NaN;
};
const f = (x, d = 1) => (Number.isFinite(x) ? x.toFixed(d) : "—");

console.log(
  "\nvariante                    netteté   lumière  interyeux   cos(réf)   visage perdu"
);
console.log("".padEnd(80, "─"));
for (const [name, xs] of Object.entries(rows)) {
  const okRows = xs.filter((x) => !x.lost);
  const lost = xs.length - okRows.length;
  console.log(
    `${name.padEnd(26)} ${f(med(okRows.map((x) => x.sharpness))).padStart(7)}   ${f(
      med(okRows.map((x) => x.brightness))
    ).padStart(6)}   ${f(med(okRows.map((x) => x.eyeDist))).padStart(7)}    ${f(
      med(okRows.map((x) => x.cos)),
      3
    ).padStart(6)}   ${lost ? `${lost}/${xs.length}` : "—"}`
  );
}
console.log(
  "\nLecture : la netteté chute d'un ordre de grandeur dès le flou ; le cosinus,"
);
console.log(
  "lui, dit à partir de quand la capture n'est plus reconnaissable (< ~0.6 = risque"
);
console.log("de refus injuste sur une personne pourtant légitime).");
