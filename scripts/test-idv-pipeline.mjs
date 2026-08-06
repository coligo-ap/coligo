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
import {
  ocrVisualZone,
  readMrz,
  terminateOcrWorkers,
} from "../lib/idv/pipeline/mrz-ocr.ts";
import { extractFromVisualZone } from "../lib/idv/doc-ocr.ts";
import { passiveLivenessScore } from "../lib/idv/pipeline/antispoof.ts";
import {
  drawChallenges,
  evaluateLiveness,
  issueChallengeToken,
  verifyChallengeToken,
  embeddingCosine,
} from "../lib/idv/liveness.ts";
import { normalizeFaceScore } from "../lib/idv/face-match.ts";
import {
  alignFace,
  estimateSimilarity,
  mirrorImage,
  ALIGN_SIZE,
  SFACE_TEMPLATE,
} from "../lib/idv/pipeline/align.ts";
import { decideIdv } from "../lib/idv/decision.ts";
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
  const read = await readMrz(rendered, "td3", parseMrz);
  const ocrMs = Math.round(performance.now() - t0);
  const parsed = read.parsed;
  ok(
    "OCR MRZ bout-en-bout : rendu → tesseract → checksums VALIDES",
    parsed?.valid === true && parsed.fields.document_number === "L898902C3",
    parsed?.valid
      ? `${ocrMs} ms · passe ${read.attempt}`
      : `texte lu :\n${read.rawText.trim()}\nparse: ${JSON.stringify(parsed?.checks ?? null)}`
  );
  await terminateOcrWorkers();
}

// ── 8) Liveness actif : défis, géométrie, jeton anti-rejeu (étape 6) ───────
{
  // Fixture : visage centré 960×1280, yeux à ±60 px du milieu, nez au milieu.
  const mkFace = ({ noseShift = 0, scale = 1, eyeDist = 120 } = {}) => {
    const w = 300 * scale;
    const midX = 480;
    return {
      x: midX - w / 2,
      y: 640 - (w * 1.2) / 2,
      w,
      h: w * 1.2,
      landmarks: [
        [midX - eyeDist / 2, 580],
        [midX + eyeDist / 2, 580],
        [midX + noseShift, 660],
        [midX - 40, 730],
        [midX + 40, 730],
      ],
      imageW: 960,
      imageH: 1280,
    };
  };

  const challenges = ["center", "turn_left", "closer"];
  const good = evaluateLiveness(challenges, [
    mkFace(),
    mkFace({ noseShift: 30 }), // nez vers la droite image = tourné vers SA gauche
    mkFace({ scale: 1.35 }),
  ]);
  ok(
    "liveness : séquence conforme → score 1",
    good.passed && good.score === 1,
    JSON.stringify(good.verdicts.map((v) => v.reason))
  );

  const wrongTurn = evaluateLiveness(challenges, [
    mkFace(),
    mkFace({ noseShift: -30 }), // tourné du MAUVAIS côté
    mkFace({ scale: 1.35 }),
  ]);
  ok(
    "liveness : rotation du mauvais côté → défi raté",
    !wrongTurn.passed &&
      wrongTurn.verdicts[1].reason === "head_turn_not_detected"
  );

  const photoTilt = evaluateLiveness(challenges, [
    mkFace(),
    // Photo inclinée : gros décalage du nez MAIS écart inter-yeux écrasé.
    mkFace({ noseShift: 40, eyeDist: 55 }),
    mkFace({ scale: 1.35 }),
  ]);
  ok(
    "liveness : photo inclinée (yeux écrasés) → détectée",
    photoTilt.verdicts[1].reason === "eye_distance_collapsed"
  );

  const staticAttack = evaluateLiveness(challenges, [
    mkFace(),
    mkFace(), // aucune rotation
    mkFace(), // aucun rapprochement
  ]);
  ok(
    "liveness : photo statique → 2 défis ratés",
    staticAttack.score < 0.5,
    `score ${staticAttack.score}`
  );

  const missing = evaluateLiveness(challenges, [
    mkFace(),
    null,
    mkFace({ scale: 1.35 }),
  ]);
  ok(
    "liveness : frame sans visage → no_face",
    missing.verdicts[1].reason === "no_face"
  );

  // Contrat ACTUEL : « center » de référence puis 2 défis tirés parmi 4
  // (ordre aléatoire, sans doublon) — 12 séquences possibles, anti-rejeu.
  const POOL = ["turn_left", "turn_right", "closer", "farther"];
  const seq = drawChallenges();
  ok(
    "défis : centre d'abord + 2 tirés parmi 4 sans doublon",
    seq.length === 3 &&
      seq[0] === "center" &&
      POOL.includes(seq[1]) &&
      POOL.includes(seq[2]) &&
      seq[1] !== seq[2],
    seq.join(" → ")
  );

  const exp = Date.now() + 60_000;
  const token = issueChallengeToken("secret-test", "verif-1", seq, exp);
  ok(
    "jeton : valide → accepté",
    verifyChallengeToken("secret-test", token, "verif-1", seq, exp)
  );
  ok(
    "jeton : défis modifiés → refusé",
    !verifyChallengeToken(
      "secret-test",
      token,
      "verif-1",
      ["center", "turn_left", "turn_right"],
      exp
    )
  );
  ok(
    "jeton : expiré → refusé",
    !verifyChallengeToken("secret-test", token, "verif-1", seq, exp, exp + 1)
  );
  ok(
    "jeton : autre dossier → refusé",
    !verifyChallengeToken("secret-test", token, "verif-2", seq, exp)
  );
  ok(
    "cosine embeddings : identité = 1",
    Math.abs(embeddingCosine([0.6, 0.8], [0.6, 0.8]) - 1) < 1e-9
  );
}

// ── 9) FACE MATCH : calibration réelle + décision automatique (étape 7) ────
// Rejoue les mesures qui ont FIXÉ les ancres de normalisation : toute dérive
// du modèle ou du pré-traitement fait échouer ce test.
// ── 8 bis) ALIGNEMENT 5 POINTS (le cœur de la précision) ───────────────────
{
  // Une similitude connue doit se retrouver exactement.
  const src = [
    [0, 0],
    [10, 0],
    [0, 10],
  ];
  const dst = src.map(([x, y]) => [2 * x + 5, 2 * y + 7]); // ×2, +(5,7)
  const t = estimateSimilarity(src, dst);
  ok(
    "alignement : similitude retrouvée (échelle 2, translation (5,7))",
    Math.abs(t.a - 2) < 1e-6 &&
      Math.abs(t.b) < 1e-6 &&
      Math.abs(t.tx - 5) < 1e-6 &&
      Math.abs(t.ty - 7) < 1e-6,
    `a=${t.a.toFixed(3)} b=${t.b.toFixed(3)} t=(${t.tx.toFixed(2)}, ${t.ty.toFixed(2)})`
  );

  // Un visage DÉJÀ au gabarit doit sortir inchangé (transformation identité).
  const flat = {
    data: new Uint8Array(ALIGN_SIZE * ALIGN_SIZE * 3).fill(128),
    width: ALIGN_SIZE,
    height: ALIGN_SIZE,
  };
  const aligned = alignFace(flat, SFACE_TEMPLATE);
  ok(
    "alignement : sortie 112×112 RGB",
    aligned.width === ALIGN_SIZE &&
      aligned.height === ALIGN_SIZE &&
      aligned.data.length === ALIGN_SIZE * ALIGN_SIZE * 3
  );
  const mir = mirrorImage(aligned);
  ok("miroir : dimensions conservées", mir.width === aligned.width);
}

if (sample) {
  // Chemin de PRODUCTION : recalage 5 points + moyenne de l'image et du miroir.
  const embedAligned = async (img, face) => {
    const crop = alignFace(img, face.landmarks, ALIGN_SIZE);
    const [a, b] = await Promise.all([
      embedFace(sface.session, crop),
      embedFace(sface.session, mirrorImage(crop)),
    ]);
    const m = new Float32Array(a.length);
    let n = 0;
    for (let i = 0; i < a.length; i++) {
      m[i] = a[i] + b[i];
      n += m[i] ** 2;
    }
    n = Math.sqrt(n);
    for (let i = 0; i < m.length; i++) m[i] /= n;
    return m;
  };
  const biggest = (fs) =>
    fs.reduce((b, f) => (!b || f.w * f.h > b.w * b.h ? f : b), null);

  const embedBuf = async (buf) => {
    const img = await decodeImage(buf, 1280);
    const face = biggest(
      await detectFaces(yunet.session, img, { scoreThreshold: 0.6 })
    );
    if (!face) return null;
    return embedAligned(img, face);
  };

  // Le recalage doit BATTRE le recadrage brut sur un selfie incliné — c'est
  // exactement le cas où l'ancien pipeline se trompait (cos 0.556 → 0.930).
  {
    const refBuf = await sharp(sample).jpeg({ quality: 92 }).toBuffer();
    const tiltBuf = await sharp(sample)
      .rotate(12, { background: "#000" })
      .jpeg({ quality: 85 })
      .toBuffer();
    const rawEmbed = async (buf) => {
      const img = await decodeImage(buf, 1280);
      const face = biggest(
        await detectFaces(yunet.session, img, { scoreThreshold: 0.6 })
      );
      if (!face) return null;
      return embedFace(
        sface.session,
        await cropResize(img, face, SFACE_INPUT_SIZE)
      );
    };
    const [rRef, rTilt, aRef, aTilt] = await Promise.all([
      rawEmbed(refBuf),
      rawEmbed(tiltBuf),
      embedBuf(refBuf),
      embedBuf(tiltBuf),
    ]);
    if (rRef && rTilt && aRef && aTilt) {
      const cosRaw = cosineSimilarity(rRef, rTilt);
      const cosAligned = cosineSimilarity(aRef, aTilt);
      ok(
        "alignement : selfie incliné 12° — le recalage bat le recadrage brut",
        cosAligned > cosRaw + 0.2,
        `brut ${cosRaw.toFixed(3)} → recalé ${cosAligned.toFixed(3)}`
      );
    }
  }

  // Portrait « carte d'identité » : petit, imprimé, recompressé + selfie.
  const idPortrait = await sharp(sample)
    .resize(180)
    .modulate({ brightness: 1.15, saturation: 0.6 })
    .jpeg({ quality: 55 })
    .toBuffer();
  const selfieBuf = await sharp(sample)
    .modulate({ brightness: 0.9 })
    .jpeg({ quality: 92 })
    .toBuffer();

  const eDoc = await embedBuf(idPortrait);
  const eSelfie = await embedBuf(selfieBuf);
  const cosSame = cosineSimilarity(eDoc, eSelfie);
  const scoreSame = normalizeFaceScore(cosSame);
  ok(
    "face match : MÊME personne (portrait carte dégradé ↔ selfie) → APPROBATION auto",
    scoreSame >= 0.6,
    `cos ${cosSame.toFixed(3)} → score ${scoreSame}`
  );

  // Personne DIFFÉRENTE (2e image d'exemple OpenCV, best effort).
  let other = null;
  try {
    const otherPath = join(tmpdir(), "coligo-idv-other-face.jpg");
    if (!existsSync(otherPath)) {
      const r = await fetch(
        "https://raw.githubusercontent.com/opencv/opencv/4.x/samples/data/messi5.jpg"
      );
      if (!r.ok) throw new Error(`HTTP ${r.status}`);
      writeFileSync(otherPath, Buffer.from(await r.arrayBuffer()));
    }
    other = readFileSync(otherPath);
  } catch (e) {
    console.log(
      `⚠️ 2e visage indisponible (${e.message}) — test imposteur sauté`
    );
  }
  if (other) {
    const eOther = await embedBuf(other);
    const cosDiff = cosineSimilarity(eOther, eSelfie);
    const scoreDiff = normalizeFaceScore(cosDiff);
    ok(
      "face match : personne DIFFÉRENTE → REFUS auto (sous le seuil)",
      scoreDiff < 0.35,
      `cos ${cosDiff.toFixed(3)} → score ${scoreDiff}`
    );
    // La marge (même personne − imposteur) est ce qui sépare vraiment les deux
    // populations : c'est elle qu'on protège des régressions.
    ok(
      "face match : marge de séparation ≥ 0.35 (alignement)",
      cosSame - cosDiff >= 0.35,
      `marge ${(cosSame - cosDiff).toFixed(3)}`
    );

    // Décision automatique de bout en bout, seuils par défaut du mode.
    const T = {
      face_match_approve: 0.6,
      face_match_reject: 0.35,
      liveness_min: 0.7,
      doc_confidence_min: 0.6,
    };
    ok(
      "décision : même personne + liveness OK → APPROBATION auto",
      decideIdv({
        thresholds: T,
        scores: { face_match: scoreSame, liveness: 1, doc_confidence: 0.9 },
        livenessRequired: true,
      }).outcome === "approve"
    );
    ok(
      "décision : imposteur → REFUS auto",
      decideIdv({
        thresholds: T,
        scores: { face_match: scoreDiff, liveness: 1, doc_confidence: 0.9 },
        livenessRequired: true,
      }).outcome === "reject"
    );
    ok(
      "décision : document expiré malgré un bon match → refus (policy défaut)",
      decideIdv({
        thresholds: T,
        scores: { face_match: scoreSame, liveness: 1, doc_confidence: 0.9 },
        documentExpired: true,
        livenessRequired: true,
      }).outcome === "reject"
    );
  }

  // Le seuil « même identité » d'OpenCV (0.363) doit tomber en zone de REVUE.
  const opencvScore = normalizeFaceScore(0.363);
  ok(
    "calibration : cos 0.363 (frontière OpenCV) → zone de revue humaine",
    opencvScore >= 0.35 && opencvScore < 0.6,
    `score ${opencvScore}`
  );
}

// ── 10) PERMIS : OCR de la zone visuelle (étape 5b — document SANS MRZ) ────
if (sample) {
  const portrait = await sharp(sample)
    .resize(160)
    .jpeg({ quality: 70 })
    .toBuffer();
  const svg = `<svg width="1000" height="640" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#eef2f7"/>
    <text x="40" y="60" font-family="Arial" font-size="28" fill="#123">REPUBLIQUE ALGERIENNE DEMOCRATIQUE ET POPULAIRE</text>
    <text x="40" y="100" font-family="Arial" font-size="24" fill="#123">PERMIS DE CONDUIRE</text>
    <text x="260" y="200" font-family="Arial" font-size="26" fill="#000">1. BENALI</text>
    <text x="260" y="245" font-family="Arial" font-size="26" fill="#000">2. KARIM</text>
    <text x="260" y="290" font-family="Arial" font-size="26" fill="#000">3. 12/05/1990  ALGER</text>
    <text x="260" y="335" font-family="Arial" font-size="26" fill="#000">4a. 15/04/2022</text>
    <text x="260" y="380" font-family="Arial" font-size="26" fill="#000">4b. 15/04/2032</text>
    <text x="260" y="425" font-family="Arial" font-size="26" fill="#000">5. 16DZ0034521</text>
  </svg>`;
  const permis = await sharp(Buffer.from(svg))
    .composite([{ input: portrait, top: 160, left: 50 }])
    .jpeg({ quality: 88 })
    .toBuffer();
  const fields = extractFromVisualZone(await ocrVisualZone(permis));
  ok(
    "permis (sans MRZ) : expiration + naissance extraites de la zone visuelle",
    fields.expiry_date === "2032-04-15" && fields.birth_date === "1990-05-12",
    `dates ${fields.dates.join(", ")}`
  );
  ok(
    "permis : numéro de document extrait",
    fields.document_number === "16DZ0034521",
    String(fields.document_number)
  );
  await terminateOcrWorkers();
}

// ── 11) ANTI-SPOOF PASSIF (MiniFASNetV2, étape 6b) ────────────────────────
if (sample) {
  const { session: fas } = await getIdvSession("minifasnet");
  const scoreOf = async (buf) => {
    const img = await decodeImage(buf, 1280);
    const f = (
      await detectFaces(yunet.session, img, { scoreThreshold: 0.6 })
    )[0];
    if (!f) return null;
    return passiveLivenessScore(fas, img, f);
  };
  const live = await scoreOf(sample);
  ok(
    "anti-spoof : vrai visage → p(vivant) élevé",
    live !== null && live >= 0.5,
    `p = ${live}`
  );
  // Attaque de présentation : photo TENUE devant l'objectif (cadre visible) —
  // c'est le contexte élargi (×2.7) qui la trahit.
  const held = await sharp(sample)
    .resize(400)
    .extend({ top: 60, bottom: 60, left: 60, right: 60, background: "#1a1a1a" })
    .modulate({ brightness: 1.12 })
    .jpeg({ quality: 45 })
    .toBuffer();
  const spoof = await scoreOf(held);
  ok(
    "anti-spoof : photo présentée à la caméra → ATTAQUE détectée",
    spoof !== null && spoof < 0.5,
    `p = ${spoof}`
  );
}

console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} OK / ${fail} KO`);
process.exit(fail === 0 ? 0 : 1);
