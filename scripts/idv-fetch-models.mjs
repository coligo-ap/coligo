// =============================================================================
// IDV — téléchargement REPRODUCTIBLE des modèles ONNX (licences vérifiées,
// docs/IDV-KYC.md). Les modèles sont ensuite COMMITÉS dans models/idv/ : ce
// script ne sert qu'à les (re)télécharger depuis la source officielle et à
// vérifier leur intégrité (SHA-256 épinglé + magic protobuf + taille).
//   node scripts/idv-fetch-models.mjs [--force]
// =============================================================================
import { createHash } from "node:crypto";
import { mkdirSync, existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const DIR = join(ROOT, "models", "idv");

/**
 * SHA-256 épinglés au premier téléchargement vérifié (13/07/2026) depuis
 * opencv_zoo (dépôt officiel OpenCV). Toute divergence future = alerte
 * supply-chain → NE PAS remplacer l'empreinte sans re-vérifier la source.
 */
const MODELS = [
  {
    file: "face_detection_yunet_2023mar.onnx",
    label: "YuNet (détection visage, MIT)",
    urls: [
      "https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_detection_yunet/face_detection_yunet_2023mar.onnx",
      "https://huggingface.co/opencv/face_detection_yunet/resolve/main/face_detection_yunet_2023mar.onnx",
    ],
    sha256: "8f2383e4dd3cfbb4553ea8718107fc0423210dc964f9f4280604804ed2552fa4",
    minBytes: 100_000,
    maxBytes: 2_000_000,
  },
  {
    file: "face_recognition_sface_2021dec.onnx",
    label: "SFace (embeddings visage, Apache-2.0)",
    urls: [
      "https://media.githubusercontent.com/media/opencv/opencv_zoo/main/models/face_recognition_sface/face_recognition_sface_2021dec.onnx",
      "https://huggingface.co/opencv/face_recognition_sface/resolve/main/face_recognition_sface_2021dec.onnx",
    ],
    sha256: "0ba9fbfa01b5270c96627c4ef784da859931e02f04419c829e83484087c34e79",
    minBytes: 20_000_000,
    maxBytes: 60_000_000,
  },
];

const force = process.argv.includes("--force");
mkdirSync(DIR, { recursive: true });

const sha256 = (buf) => createHash("sha256").update(buf).digest("hex");

async function download(url) {
  const res = await fetch(url, { redirect: "follow" });
  if (!res.ok) throw new Error(`HTTP ${res.status} — ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

function checkIntegrity(model, buf) {
  if (buf.length < model.minBytes || buf.length > model.maxBytes) {
    throw new Error(
      `${model.file} : taille inattendue (${buf.length} octets) — pointeur Git-LFS ou page d'erreur ?`
    );
  }
  // Un .onnx est un protobuf ModelProto : commence par le champ 1 varint
  // (ir_version), tag 0x08. Un pointeur LFS commencerait par "version http…".
  if (buf[0] !== 0x08) {
    throw new Error(`${model.file} : magic ONNX absent (octet 0 = ${buf[0]})`);
  }
  const hash = sha256(buf);
  if (model.sha256 && hash !== model.sha256) {
    throw new Error(
      `${model.file} : SHA-256 DIVERGENT !\n  attendu : ${model.sha256}\n  obtenu  : ${hash}\n  → possible compromission de la source, NE PAS utiliser.`
    );
  }
  return hash;
}

let failed = false;
for (const model of MODELS) {
  const dest = join(DIR, model.file);
  if (existsSync(dest) && !force) {
    const hash = checkIntegrity(model, readFileSync(dest));
    console.log(
      `✅ ${model.label} — déjà présent, intègre (${hash.slice(0, 16)}…)`
    );
    continue;
  }
  let done = false;
  for (const url of model.urls) {
    try {
      process.stdout.write(`⬇️  ${model.label} ← ${new URL(url).host} … `);
      const buf = await download(url);
      const hash = checkIntegrity(model, buf);
      writeFileSync(dest, buf);
      console.log(`OK (${(buf.length / 1e6).toFixed(1)} Mo)`);
      if (!model.sha256) {
        console.log(`   ⚠️ SHA-256 à épingler dans ce script : ${hash}`);
      }
      done = true;
      break;
    } catch (e) {
      console.log(`échec : ${e.message}`);
    }
  }
  if (!done) {
    console.error(`❌ ${model.file} : aucune source n'a fonctionné.`);
    failed = true;
  }
}
process.exit(failed ? 1 : 0);
