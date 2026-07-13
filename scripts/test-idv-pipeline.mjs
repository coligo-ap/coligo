// =============================================================================
// Banc de test du pipeline ML IDV (étape 3) — inférence RÉELLE locale.
// 1) Chargement des modèles (models/idv/, intégrité déjà épinglée).
// 2) YuNet : bruit synthétique (sanité + perf) puis VRAI visage (image
//    d'exemple OpenCV téléchargée dans le tmp, jamais commitée) → le décodage
//    des têtes cls/obj/bbox/kps est validé fonctionnellement.
// 3) SFace : dimensions, normalisation L2, cosinus self ≈ 1, bruit ≠ bruit.
//   node --experimental-strip-types scripts/test-idv-pipeline.mjs
// =============================================================================
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { getIdvSession, idvModelPath } from "../lib/idv/pipeline/onnx.ts";
import { decodeImage, cropResize } from "../lib/idv/pipeline/image.ts";
import { detectFaces } from "../lib/idv/pipeline/yunet.ts";
import {
  embedFace,
  cosineSimilarity,
  SFACE_INPUT_SIZE,
  SFACE_EMBEDDING_DIM,
} from "../lib/idv/pipeline/sface.ts";
import { assessDocQuality } from "../lib/idv/pipeline/quality.ts";
import sharp from "sharp";

let pass = 0,
  fail = 0;
const ok = (l, cond, extra = "") => {
  console.log(`${cond ? "✅" : "❌"} ${l}${extra ? ` — ${extra}` : ""}`);
  cond ? pass++ : fail++;
};

// Bruit déterministe.
function noise(width, height, seed = 0x9e3779b9) {
  const data = new Uint8Array(width * height * 3);
  let s = seed;
  for (let i = 0; i < data.length; i++) {
    s ^= s << 13;
    s ^= s >>> 17;
    s ^= s << 5;
    data[i] = s & 0xff;
  }
  return { data, width, height };
}

// ── 1) Modèles présents + sessions ──────────────────────────────────────────
for (const key of ["yunet", "sface"]) {
  if (!existsSync(idvModelPath(key))) {
    console.error(
      `❌ modèle ${key} absent — lancer : node scripts/idv-fetch-models.mjs`
    );
    process.exit(1);
  }
}
let t = performance.now();
const yunet = await getIdvSession("yunet");
const sface = await getIdvSession("sface");
ok(
  "sessions ONNX chargées",
  true,
  `yunet ${yunet.loadMs} ms, sface ${sface.loadMs} ms`
);
console.log(`   yunet outputs: ${yunet.session.outputNames.join(", ")}`);

// ── 2) YuNet — bruit synthétique (sanité + perf) ────────────────────────────
t = performance.now();
const noiseFaces = await detectFaces(yunet.session, noise(320, 256));
const noiseMs = Math.round(performance.now() - t);
ok(
  "YuNet tourne sur bruit (décodage sans erreur)",
  Array.isArray(noiseFaces),
  `${noiseFaces.length} détection(s), ${noiseMs} ms`
);
ok("YuNet : (quasi) aucun faux visage dans le bruit", noiseFaces.length <= 1);

// ── 3) YuNet + SFace — VRAI visage (best effort réseau) ────────────────────
const SAMPLE_URL =
  "https://raw.githubusercontent.com/opencv/opencv/4.x/samples/data/lena.jpg";
const cachePath = join(tmpdir(), "coligo-idv-sample-face.jpg");
let sample = null;
try {
  if (!existsSync(cachePath)) {
    const res = await fetch(SAMPLE_URL);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    writeFileSync(cachePath, Buffer.from(await res.arrayBuffer()));
  }
  sample = readFileSync(cachePath);
} catch (e) {
  console.log(`⚠️ image d'exemple indisponible (${e.message}) — test sauté`);
}

if (sample) {
  const image = await decodeImage(sample);
  t = performance.now();
  const faces = await detectFaces(yunet.session, image, {
    scoreThreshold: 0.7,
  });
  const ms = Math.round(performance.now() - t);
  ok(
    "YuNet détecte le visage de l'image d'exemple",
    faces.length >= 1,
    faces.length
      ? `score ${faces[0].score.toFixed(3)}, boîte ${Math.round(faces[0].w)}×${Math.round(faces[0].h)}, ${ms} ms`
      : `0 détection en ${ms} ms`
  );
  if (faces.length) {
    const f = faces[0];
    ok(
      "5 repères dans la boîte (décodage kps cohérent)",
      f.landmarks.length === 5 &&
        f.landmarks.every(
          ([x, y]) =>
            x >= f.x - f.w * 0.2 &&
            x <= f.x + f.w * 1.2 &&
            y >= f.y - f.h * 0.2 &&
            y <= f.y + f.h * 1.2
        )
    );
    const crop = await cropResize(image, f, SFACE_INPUT_SIZE);
    const e1 = await embedFace(sface.session, crop);
    const e2 = await embedFace(sface.session, crop);
    ok(
      "SFace : même crop ⇒ même embedding (déterminisme)",
      cosineSimilarity(e1, e2) > 0.999,
      `cos = ${cosineSimilarity(e1, e2).toFixed(4)}`
    );
  }
}

// ── 4) SFace — sanité numérique ─────────────────────────────────────────────
t = performance.now();
const a = await embedFace(sface.session, noise(112, 112, 1));
const sfaceMs = Math.round(performance.now() - t);
const b = await embedFace(sface.session, noise(112, 112, 2));
let norm = 0;
for (const v of a) norm += v * v;
ok("SFace : embedding 128 dims", a.length === SFACE_EMBEDDING_DIM);
ok(
  "SFace : embedding L2-normalisé",
  Math.abs(Math.sqrt(norm) - 1) < 1e-3,
  `‖v‖ = ${Math.sqrt(norm).toFixed(5)}, ${sfaceMs} ms`
);
ok("SFace : cos(v, v) = 1", Math.abs(cosineSimilarity(a, a) - 1) < 1e-3);
ok(
  "SFace : deux bruits différents ⇒ embeddings distincts",
  cosineSimilarity(a, b) < 0.99,
  `cos = ${cosineSimilarity(a, b).toFixed(4)}`
);

// ── 5) Qualité document (check doc_quality, étape 4) ───────────────────────
{
  // Image « document » synthétique : bruit fin = netteté maximale.
  const docNoise = noise(1280, 800, 42);
  const base = sharp(docNoise.data, {
    raw: { width: 1280, height: 800, channels: 3 },
  });
  const sharpJpg = await base.clone().jpeg({ quality: 95 }).toBuffer();
  const blurryJpg = await base
    .clone()
    .blur(10)
    .jpeg({ quality: 95 })
    .toBuffer();
  const darkJpg = await base
    .clone()
    .linear(0.12, 0)
    .jpeg({ quality: 95 })
    .toBuffer();
  const tinyJpg = await base.clone().resize(320, 200).jpeg().toBuffer();

  const qSharp = await assessDocQuality(sharpJpg);
  ok(
    "qualité : image nette → passed",
    qSharp.verdict === "passed",
    `netteté ${qSharp.metrics.sharpness}, score ${qSharp.score}`
  );
  const qBlur = await assessDocQuality(blurryJpg);
  ok(
    "qualité : image floue → blurry",
    qBlur.verdict === "failed" && qBlur.reasons.includes("blurry"),
    `netteté ${qBlur.metrics.sharpness}`
  );
  const qDark = await assessDocQuality(darkJpg);
  ok(
    "qualité : image sombre → too_dark",
    qDark.verdict === "failed" && qDark.reasons.includes("too_dark"),
    `luminosité ${qDark.metrics.brightness}`
  );
  const qTiny = await assessDocQuality(tinyJpg);
  ok(
    "qualité : image trop petite → low_resolution",
    qTiny.verdict === "failed" && qTiny.reasons.includes("low_resolution"),
    `${qTiny.metrics.width}×${qTiny.metrics.height}`
  );
}

console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} OK / ${fail} KO`);
process.exit(fail === 0 ? 0 : 1);
