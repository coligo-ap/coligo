// =============================================================================
// IDV — CONSTRUCTION du corpus de calibration du face match.
//
// POURQUOI CE SCRIPT EXISTE.
// Jusqu'ici les seuils du face match étaient calibrés sur DEUX visages
// (les images d'exemple d'OpenCV), et les paires « même personne » étaient
// fabriquées en DÉGRADANT LA MÊME PHOTO. Or dans la vraie vie, le portrait du
// document et le selfie sont deux photos DIFFÉRENTES, prises à des années
// d'écart, sous d'autres lumières, avec un autre appareil. Un seuil calibré sur
// « la même photo en moins bien » est donc trop optimiste : il ne dit rien de
// la vraie frontière entre « c'est bien lui » et « c'est quelqu'un d'autre ».
//
// Ce script construit un corpus HONNÊTE :
//   • plusieurs identités, chacune avec des photos réellement différentes
//     (angles, âges, éclairages) → vraies paires « même personne » ;
//   • toutes les paires croisées entre identités → vrais imposteurs, y compris
//     des imposteurs DIFFICILES (même sexe, même tranche d'âge, même type).
//
// LICENCES (règle du projet : usage commercial explicite, vérifié).
// Les images viennent de Wikimedia Commons et CHAQUE fichier est filtré sur sa
// licence réelle (extmetadata) : seuls le domaine public, CC0, CC BY et CC BY-SA
// sont retenus. Le manifeste conserve titre + licence + auteur de chaque photo
// (attribution). Rien n'est commité : tout vit dans le dossier temporaire.
//
//   node --experimental-strip-types scripts/idv-corpus.mjs [--force]
// =============================================================================
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  rmSync,
} from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { getIdvSession } from "../lib/idv/pipeline/onnx.ts";
import { decodeImage } from "../lib/idv/pipeline/image.ts";
import { detectFaces } from "../lib/idv/pipeline/yunet.ts";

export const CORPUS_DIR = join(tmpdir(), "coligo-idv-corpus");
export const MANIFEST = join(CORPUS_DIR, "manifest.json");

/**
 * Identités du corpus. Choisies pour ce qui compte vraiment en calibration :
 * beaucoup de photos libres et VARIÉES par personne, et surtout des COHORTES
 * qui se ressemblent (même sexe, même âge, mêmes traits) — ce sont ces
 * imposteurs-là qui font échouer un système de reconnaissance faciale, pas
 * deux personnes que tout oppose.
 */
const IDENTITIES = [
  { key: "obama", search: "Barack Obama", cohort: "h" },
  { key: "macron", search: "Emmanuel Macron", cohort: "h" },
  { key: "trudeau", search: "Justin Trudeau", cohort: "h" },
  { key: "modi", search: "Narendra Modi", cohort: "h" },
  { key: "ronaldo", search: "Cristiano Ronaldo", cohort: "h" },
  { key: "messi", search: "Lionel Messi", cohort: "h" },
  { key: "zidane", search: "Zinedine Zidane", cohort: "h" },
  { key: "elba", search: "Idris Elba", cohort: "h" },
  { key: "merkel", search: "Angela Merkel", cohort: "f" },
  { key: "harris", search: "Kamala Harris", cohort: "f" },
  { key: "ardern", search: "Jacinda Ardern", cohort: "f" },
  { key: "rihanna", search: "Rihanna", cohort: "f" },
  { key: "serena", search: "Serena Williams", cohort: "f" },
  { key: "lagarde", search: "Christine Lagarde", cohort: "f" },
];

/** Photos gardées par identité (≥ 2 pour former une paire « même personne »). */
const PER_IDENTITY = 3;
/** Candidats examinés au maximum avant d'abandonner une identité. */
const MAX_CANDIDATES = 30;

/** Licences ACCEPTÉES (usage commercial explicite). */
const LICENCE_OK =
  /^(cc0|cc by|cc by-sa|public domain|pd|no restrictions|attribution)/i;

/** Ce qui n'est pas une photo du visage de la personne. */
const TITLE_BLOCKLIST =
  /(signature|logo|coat of arms|flag|seal|statue|monument|grave|plaque|stamp|banknote|coin|poster|cartoon|caricature|drawing|painting|mural|graffiti|book|cover|map|chart|diagram|screenshot|building|wax)/i;

/** Wikimedia exige un User-Agent identifiable et limite le débit : on ralentit
 *  volontairement et on réessaie sur 429 plutôt que de marteler l'API. */
const UA = "coligo-idv-calibration/1.0 (https://coligo.dz; contact@coligo.dz)";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function polite(url) {
  for (let attempt = 0; attempt < 4; attempt++) {
    const res = await fetch(url, {
      headers: { "user-agent": UA },
      signal: AbortSignal.timeout(30_000),
    });
    if (res.status === 429) {
      await sleep(2000 * (attempt + 1));
      continue;
    }
    return res;
  }
  throw new Error("HTTP 429 persistant (débit Commons)");
}

const api = async (params) => {
  const url = new URL("https://commons.wikimedia.org/w/api.php");
  for (const [k, v] of Object.entries({
    format: "json",
    formatversion: "2",
    ...params,
  }))
    url.searchParams.set(k, String(v));
  const res = await polite(url);
  if (!res.ok) throw new Error(`API Commons : HTTP ${res.status}`);
  return res.json();
};

/** Empreinte perceptuelle 64 bits (dHash) — deux recadrages de la MÊME photo
 *  donneraient une paire « même personne » artificiellement parfaite. */
async function dhash(buf) {
  const { data } = await sharp(buf)
    .grayscale()
    .resize(9, 8, { fit: "fill" })
    .raw()
    .toBuffer({ resolveWithObject: true });
  let bits = 0n;
  for (let y = 0; y < 8; y++)
    for (let x = 0; x < 8; x++) {
      const i = y * 9 + x;
      bits = (bits << 1n) | (data[i] < data[i + 1] ? 1n : 0n);
    }
  return bits;
}

const hamming = (a, b) => {
  let x = a ^ b;
  let n = 0;
  while (x) {
    n += Number(x & 1n);
    x >>= 1n;
  }
  return n;
};

/**
 * Une photo n'entre dans le corpus que si elle porte UN visage exploitable :
 * assez grand pour être biométrique, et sans second visage qui rendrait
 * l'identité ambiguë (photo de groupe, poignée de main, tribune).
 */
async function usableFace(yunet, buf) {
  const img = await decodeImage(buf, 1280);
  const faces = await detectFaces(yunet, img, { scoreThreshold: 0.7 });
  if (faces.length === 0) return { reject: "aucun visage" };
  const sorted = [...faces].sort((a, b) => b.w * b.h - a.w * a.h);
  const main = sorted[0];
  const second = sorted[1];
  const side = Math.round(Math.min(main.w, main.h));
  if (side < 90) return { reject: `visage ${side}px` };
  if (main.score < 0.8) return { reject: `score ${main.score.toFixed(2)}` };
  if (second && (second.w * second.h) / (main.w * main.h) > 0.35)
    return { reject: "identité ambiguë (2 visages)" };
  return {
    face: { w: Math.round(main.w), h: Math.round(main.h), score: main.score },
  };
}

async function collect(identity, yunet) {
  const data = await api({
    action: "query",
    generator: "search",
    gsrsearch: `${identity.search} filetype:bitmap`,
    gsrnamespace: 6,
    gsrlimit: MAX_CANDIDATES,
    prop: "imageinfo",
    iiprop: "url|extmetadata|mime",
    iiurlwidth: 900,
  });
  const pages = data?.query?.pages ?? [];
  const kept = [];
  const hashes = [];
  const rejected = [];

  for (const page of pages) {
    if (kept.length >= PER_IDENTITY) break;
    const info = page.imageinfo?.[0];
    if (!info || !/^image\/(jpeg|png)$/.test(info.mime ?? "")) continue;
    if (TITLE_BLOCKLIST.test(page.title)) continue;

    const meta = info.extmetadata ?? {};
    const licence = meta.LicenseShortName?.value ?? "";
    if (!LICENCE_OK.test(licence.trim())) {
      rejected.push(`licence « ${licence.trim() || "?"} »`);
      continue;
    }

    try {
      await sleep(250); // débit poli
      const res = await polite(info.thumburl ?? info.url);
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());

      // Doublon perceptuel = même photo ré-uploadée/recadrée → écartée.
      const h = await dhash(buf);
      if (hashes.some((prev) => hamming(prev, h) < 12)) {
        rejected.push("doublon perceptuel");
        continue;
      }

      const { face, reject } = await usableFace(yunet, buf);
      if (!face) {
        rejected.push(reject);
        continue;
      }

      const file = join(CORPUS_DIR, identity.key, `${kept.length}.jpg`);
      mkdirSync(join(CORPUS_DIR, identity.key), { recursive: true });
      await sharp(buf)
        .rotate()
        .resize({ width: 1280, withoutEnlargement: true })
        .jpeg({ quality: 92 })
        .toFile(file);
      hashes.push(h);
      kept.push({
        file,
        title: page.title,
        licence: licence.trim(),
        author: (meta.Artist?.value ?? "")
          .replace(/<[^>]*>/g, "")
          .slice(0, 120),
        sha256: createHash("sha256").update(buf).digest("hex").slice(0, 16),
        face,
      });
      process.stdout.write(`  · ${page.title} [${licence.trim()}]\n`);
    } catch (e) {
      rejected.push(e.message);
    }
  }
  if (kept.length < PER_IDENTITY && rejected.length) {
    const tally = {};
    for (const r of rejected) tally[r] = (tally[r] ?? 0) + 1;
    const top = Object.entries(tally)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 3)
      .map(([r, n]) => `${r} ×${n}`)
      .join(", ");
    process.stdout.write(`    (écartés : ${top})\n`);
  }
  return kept;
}

const force = process.argv.includes("--force");
if (force && existsSync(CORPUS_DIR)) rmSync(CORPUS_DIR, { recursive: true });
if (existsSync(MANIFEST) && !force) {
  const m = JSON.parse(readFileSync(MANIFEST, "utf8"));
  console.log(
    `Corpus déjà en cache : ${m.identities.length} identités, ${m.identities.reduce((n, i) => n + i.photos.length, 0)} photos.`
  );
  console.log(`(${MANIFEST}) — relancer avec --force pour reconstruire.`);
  process.exit(0);
}

mkdirSync(CORPUS_DIR, { recursive: true });
const { session: yunet } = await getIdvSession("yunet");

const identities = [];
for (const identity of IDENTITIES) {
  console.log(`\n${identity.search}`);
  try {
    const photos = await collect(identity, yunet);
    if (photos.length < 2) {
      console.log(`  ⚠️ ${photos.length} photo(s) exploitable(s) — écartée`);
      continue;
    }
    identities.push({ ...identity, photos });
  } catch (e) {
    console.log(`  ⚠️ ${e.message}`);
  }
}

if (identities.length < 4) {
  console.error(
    `\n❌ Corpus insuffisant (${identities.length} identités) — réseau ou API Commons indisponible.`
  );
  process.exit(1);
}

writeFileSync(
  MANIFEST,
  JSON.stringify({ builtAt: new Date().toISOString(), identities }, null, 2)
);

// Planche-contact : une image unique pour VÉRIFIER À L'ŒIL que chaque ligne
// montre bien la même personne (un corpus mal étiqueté fausserait tout).
const THUMB = 160;
const rows = await Promise.all(
  identities.map(async (id) => {
    const cells = await Promise.all(
      id.photos
        .slice(0, PER_IDENTITY)
        .map((p) =>
          sharp(p.file).resize(THUMB, THUMB, { fit: "cover" }).toBuffer()
        )
    );
    return { key: id.key, cells };
  })
);
const sheet = sharp({
  create: {
    width: THUMB * PER_IDENTITY,
    height: THUMB * rows.length,
    channels: 3,
    background: "#111",
  },
}).composite(
  rows.flatMap((row, y) =>
    row.cells.map((input, x) => ({
      input,
      left: x * THUMB,
      top: y * THUMB,
    }))
  )
);
const sheetPath = join(CORPUS_DIR, "planche-contact.png");
await sheet.png().toFile(sheetPath);

const total = identities.reduce((n, i) => n + i.photos.length, 0);
console.log(
  `\n✅ Corpus : ${identities.length} identités, ${total} photos (licences vérifiées).`
);
console.log(`   manifeste       : ${MANIFEST}`);
console.log(`   planche-contact : ${sheetPath}`);
console.log(`   ordre des lignes : ${identities.map((i) => i.key).join(", ")}`);
