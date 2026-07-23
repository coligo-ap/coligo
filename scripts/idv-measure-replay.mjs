// =============================================================================
// « Le selfie n'est-il pas simplement la PHOTO DU DOCUMENT ? »
//
// Un fraudeur peut recadrer le portrait de la carte et le présenter comme selfie.
// Le cosinus ne le trahit PAS : deux vraies photos de la même personne peuvent
// monter à 0.93, et une image rejouée redescend à 0.90 après recompression — les
// deux se recouvrent. Il faut donc un signal d'IMAGE, pas d'identité.
//
// On compare l'empreinte perceptuelle (dHash 64 bits) des visages RECALÉS :
//   • même photo des deux côtés (rejeu)      → les pixels se ressemblent ;
//   • deux photos différentes (cas légitime) → même visage, mais autres pixels.
// Ce script mesure les deux distributions pour fixer le seuil sur des nombres.
//
//   node --experimental-strip-types --import ./scripts/_alias.mjs scripts/idv-measure-replay.mjs
// =============================================================================
import { readFileSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { getIdvSession } from "../lib/idv/pipeline/onnx.ts";
import { decodeImage } from "../lib/idv/pipeline/image.ts";
import {
  findBestFace,
  findFaceUpright,
} from "../lib/idv/pipeline/face-embed.ts";
import { alignFace, ALIGN_SIZE } from "../lib/idv/pipeline/align.ts";
import {
  faceDHash,
  hammingDistance,
} from "../lib/idv/pipeline/face-quality.ts";

const MANIFEST = join(tmpdir(), "coligo-idv-corpus", "manifest.json");
if (!existsSync(MANIFEST)) {
  console.error("❌ Corpus absent — lancer scripts/idv-corpus.mjs");
  process.exit(1);
}
const { identities } = JSON.parse(readFileSync(MANIFEST, "utf8"));
const { session: yunet } = await getIdvSession("yunet");

/** Visage recalé 112×112 (ce que compare le face match). */
async function alignedFace(buf, upright) {
  const img = await decodeImage(buf, upright ? 960 : 1280);
  const found = upright
    ? await findFaceUpright(yunet, img)
    : await findBestFace(yunet, img);
  if (!found) return null;
  const face = upright ? found.face : found.face;
  const image = upright ? img : found.image;
  if (face.landmarks.length < 5) return null;
  return alignFace(image, face.landmarks, ALIGN_SIZE);
}

/** Portrait « carte d'identité » extrait d'une photo (comme en production). */
async function documentPortrait(file) {
  const img = await decodeImage(readFileSync(file), 1280);
  const found = await findBestFace(yunet, img);
  if (!found) return null;
  const { face } = found;
  const pad = Math.max(face.w, face.h) * 0.45;
  const left = Math.max(0, Math.round(face.x - pad));
  const top = Math.max(0, Math.round(face.y - pad * 1.2));
  const width = Math.min(img.width - left, Math.round(face.w + pad * 2));
  const height = Math.min(img.height - top, Math.round(face.h + pad * 2.2));
  return sharp(img.data, {
    raw: { width: img.width, height: img.height, channels: 3 },
  })
    .extract({ left, top, width, height })
    .resize(170)
    .modulate({ brightness: 1.12, saturation: 0.65 })
    .jpeg({ quality: 55 })
    .toBuffer();
}

const replay = [];
const legit = [];

for (const id of identities) {
  const photos = id.photos;
  const docBuf = await documentPortrait(photos[0].file);
  if (!docBuf) continue;
  const docFace = await alignedFace(docBuf, false);
  if (!docFace) continue;
  const docHash = faceDHash(docFace);

  // REJEU : le fraudeur re-photographie / recadre le portrait du document et
  // l'envoie comme selfie (avec la dégradation d'un ré-encodage caméra).
  const replayed = await sharp(docBuf)
    .resize({ width: 640 })
    .modulate({ brightness: 0.95 })
    .jpeg({ quality: 80 })
    .toBuffer();
  const replayFace = await alignedFace(replayed, true);
  if (replayFace) replay.push(hammingDistance(docHash, faceDHash(replayFace)));

  // LÉGITIME : le selfie est une AUTRE photo de la même personne.
  for (const photo of photos.slice(1)) {
    const selfieFace = await alignedFace(
      await sharp(readFileSync(photo.file)).jpeg({ quality: 80 }).toBuffer(),
      true
    );
    if (selfieFace) legit.push(hammingDistance(docHash, faceDHash(selfieFace)));
  }
}

const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  return {
    n: s.length,
    min: s[0],
    med: s[Math.floor(s.length / 2)],
    max: s[s.length - 1],
  };
};
const r = stats(replay);
const l = stats(legit);

console.log(
  "\n── DISTANCE PERCEPTUELLE (dHash) entre le visage du document et le selfie"
);
console.log(
  `REJEU (le selfie EST le portrait) : n=${r.n}  min ${r.min}  médiane ${r.med}  max ${r.max}`
);
console.log(
  `LÉGITIME (autre photo, même tête)  : n=${l.n}  min ${l.min}  médiane ${l.med}  max ${l.max}`
);
console.log(
  `\nSéparation : rejeu max ${r.max} │ légitime min ${l.min} → seuil sûr = ${Math.floor((r.max + l.min) / 2)}`
);
