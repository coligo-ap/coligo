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
import { computeCheckDigit, parseMrz } from "../lib/idv/mrz.ts";
import { getMrzWorker, ocrMrzBand } from "../lib/idv/pipeline/mrz-ocr.ts";
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

// ── 6) MRZ — spécimens OFFICIELS ICAO Doc 9303 (étape 5) ───────────────────
{
  ok("checksum ICAO : L898902C3 → 6", computeCheckDigit("L898902C3") === 6);
  ok("checksum ICAO : 740812 → 2", computeCheckDigit("740812") === 2);

  // TD3 (passeport) — spécimen ERIKSSON, Doc 9303 partie 4.
  const td3 = parseMrz([
    "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<",
    "L898902C36UTO7408122F1204159ZE184226B<<<<<10",
  ]);
  ok(
    "TD3 spécimen : VALIDE, tous les checksums passent",
    td3?.valid === true && td3.score === 1,
    td3 ? JSON.stringify(td3.checks) : "parse null"
  );
  ok(
    "TD3 spécimen : champs extraits",
    td3?.fields.surname === "ERIKSSON" &&
      td3?.fields.given_names === "ANNA MARIA" &&
      td3?.fields.document_number === "L898902C3" &&
      td3?.fields.birth_date === "1974-08-12" &&
      td3?.fields.sex === "F" &&
      td3?.fields.expiry_date === "2012-04-15" &&
      td3?.fields.personal_number === "ZE184226B",
    JSON.stringify(td3?.fields)
  );

  // Altération d'un chiffre → checksums KO (signal de fraude).
  const tampered = parseMrz([
    "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<",
    "L898902C36UTO7508122F1204159ZE184226B<<<<<10",
  ]);
  ok(
    "TD3 altéré (date de naissance) → INVALIDE",
    tampered?.valid === false && tampered.checks.birth_date === false
  );

  // Réparation OCR : O lu à la place de 0 dans une zone numérique.
  const repaired = parseMrz([
    "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<",
    "L898902C36UTO74O8122F12O4159ZE184226B<<<<<10",
  ]);
  ok(
    "TD3 avec O↔0 dans les dates → réparé, checksums OK",
    repaired?.checks.birth_date === true &&
      repaired?.checks.expiry_date === true
  );

  // TD1 (carte ID) — spécimen Doc 9303 partie 5.
  const td1 = parseMrz([
    "I<UTOD231458907<<<<<<<<<<<<<<<",
    "7408122F1204159UTO<<<<<<<<<<<6",
    "ERIKSSON<<ANNA<MARIA<<<<<<<<<<",
  ]);
  ok(
    "TD1 spécimen : VALIDE + champs",
    td1?.valid === true &&
      td1.format === "td1" &&
      td1.fields.document_number === "D23145890" &&
      td1.fields.surname === "ERIKSSON" &&
      td1.fields.expiry_date === "2012-04-15",
    td1 ? JSON.stringify(td1.checks) : "parse null"
  );

  // Lignes parasites autour : le parseur s'accroche aux bonnes.
  const noisy = parseMrz([
    "REPUBLIQUE ALGERIENNE",
    "I<UTOD231458907<<<<<<<<<<<<<<<",
    "7408122F1204159UTO<<<<<<<<<<<6",
    "ERIKSSON<<ANNA<MARIA<<<<<<<<<<",
  ]);
  ok("TD1 avec lignes parasites → toujours parsé", noisy?.valid === true);
}

// ── 7) OCR MRZ BOUT-EN-BOUT : image rendue → tesseract → checksums ─────────
{
  const l1 = "P<UTOERIKSSON<<ANNA<MARIA<<<<<<<<<<<<<<<<<<<";
  const l2 = "L898902C36UTO7408122F1204159ZE184226B<<<<<10";
  const esc = (s) => s.replace(/</g, "&lt;");
  const svg = `<svg width="1240" height="230" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="white"/>
    <text x="24" y="95" font-family="Courier New, Courier, monospace" font-size="42" fill="black">${esc(l1)}</text>
    <text x="24" y="175" font-family="Courier New, Courier, monospace" font-size="42" fill="black">${esc(l2)}</text>
  </svg>`;
  const rendered = await sharp(Buffer.from(svg)).png().toBuffer();
  const t0 = performance.now();
  const text = await ocrMrzBand(rendered, null);
  const ocrMs = Math.round(performance.now() - t0);
  const parsed = parseMrz(text.split(/\r?\n/));
  ok(
    "OCR MRZ bout-en-bout : rendu → tesseract → checksums VALIDES",
    parsed?.valid === true && parsed.fields.document_number === "L898902C3",
    parsed?.valid
      ? `${ocrMs} ms`
      : `texte lu :\n${text.trim()}\nparse: ${JSON.stringify(parsed?.checks ?? null)}`
  );
  await (await getMrzWorker()).terminate();
}

console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} OK / ${fail} KO`);
process.exit(fail === 0 ? 0 : 1);
