// =============================================================================
// IDV — test END-TO-END contre les routes DÉPLOYÉES (étape 10).
// Fabrique de vraies pièces (carte d'identité avec portrait imprimé + MRZ TD1
// aux sommes de contrôle VALIDES, selfie, imposteur), les envoie dans le
// bucket privé, joue les trois routes du pipeline, puis applique le moteur de
// décision — exactement comme le fait l'action serveur.
//
// Ce que le test PROUVE :
//   1. un document conforme est lu (portrait + MRZ + expiration) ;
//   2. la même personne est approuvée automatiquement ;
//   3. un IMPOSTEUR est refusé automatiquement ;
//   4. une ATTAQUE PAR PHOTO (frames statiques) échoue au liveness ;
//   5. un document EXPIRÉ est refusé, même avec un visage parfait ;
//   6. les routes internes refusent tout appel sans secret (401).
// Nettoie systématiquement le bucket (même en cas d'échec).
//
//   node --experimental-strip-types scripts/test-idv-e2e.mjs [--local]
// =============================================================================
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";
import { loadEnvLocal } from "./_supabase.mjs";
import { computeCheckDigit, parseMrz } from "../lib/idv/mrz.ts";
import { evaluateLiveness } from "../lib/idv/liveness.ts";
import { decideIdv } from "../lib/idv/decision.ts";

loadEnvLocal();
const BASE = process.argv.includes("--local")
  ? "http://localhost:3000"
  : (process.env.NEXT_PUBLIC_APP_URL ?? "https://coligo.app");
const SECRET = process.env.INTERNAL_IDV_SECRET;
const BUCKET = "idv-captures";
const PREFIX = `_e2e/${Date.now()}`;

if (!SECRET) {
  console.error("❌ INTERNAL_IDV_SECRET manquant (.env.local)");
  process.exit(1);
}

let pass = 0,
  fail = 0;
const ok = (label, cond, extra = "") => {
  console.log(`${cond ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
  cond ? pass++ : fail++;
};

// ── Fixtures ────────────────────────────────────────────────────────────────

/** Visage de référence (image d'exemple OpenCV, mise en cache dans le tmp). */
async function sampleFace(name, url) {
  const path = join(tmpdir(), `coligo-idv-${name}`);
  if (!existsSync(path)) {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`téléchargement ${name} : HTTP ${res.status}`);
    writeFileSync(path, Buffer.from(await res.arrayBuffer()));
  }
  return readFileSync(path);
}

/** MRZ TD1 (3×30) aux sommes de contrôle VALIDES, expiration paramétrable. */
function buildTd1(docNumber, birth, sex, expiry, nationality, surname, given) {
  const pad = (s, n) => s.padEnd(n, "<").slice(0, n);
  const l1Body = pad(docNumber, 9);
  const l1 = `ID DZA`.replace(" ", "<") + l1Body; // I<DZA + n° doc
  const line1 = pad(
    `I<${pad(nationality, 3)}${l1Body}${computeCheckDigit(l1Body)}`,
    30
  );
  const optional2 = pad("", 11);
  const l2Head = `${birth}${computeCheckDigit(birth)}${sex}${expiry}${computeCheckDigit(
    expiry
  )}${pad(nationality, 3)}${optional2}`;
  const composite =
    line1.slice(5, 30) +
    l2Head.slice(0, 7) +
    l2Head.slice(8, 15) +
    l2Head.slice(18, 29);
  const line2 = pad(`${l2Head}${computeCheckDigit(composite)}`, 30);
  const line3 = pad(`${surname}<<${given}`, 30);
  void l1;
  return [line1, line2, line3];
}

/** Carte d'identité : portrait imprimé + zone MRZ (verso). */
async function buildCard(face, mrzLines) {
  const portrait = await sharp(face)
    .resize(190)
    .modulate({ brightness: 1.12, saturation: 0.65 })
    .jpeg({ quality: 60 })
    .toBuffer();
  const front = await sharp({
    create: {
      width: 856,
      height: 540,
      channels: 3,
      background: "#e9e9ee",
    },
  })
    .composite([{ input: portrait, top: 150, left: 60 }])
    .jpeg({ quality: 92 })
    .toBuffer();

  const esc = (s) => s.replace(/</g, "&lt;");
  const svg = `<svg width="856" height="540" xmlns="http://www.w3.org/2000/svg">
    <rect width="100%" height="100%" fill="#f2f2f4"/>
    ${mrzLines
      .map(
        (l, i) =>
          `<text x="30" y="${380 + i * 52}" font-family="Courier New, Courier, monospace" font-size="34" fill="#111">${esc(
            l
          )}</text>`
      )
      .join("")}
  </svg>`;
  const back = await sharp(Buffer.from(svg)).jpeg({ quality: 92 }).toBuffer();
  return { front, back };
}

// ── Client Storage (service_role) ───────────────────────────────────────────
const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);
const uploaded = [];
async function put(name, buf) {
  const path = `${PREFIX}/${name}`;
  const { error } = await admin.storage
    .from(BUCKET)
    .upload(path, buf, { contentType: "image/jpeg", upsert: true });
  if (error) throw new Error(`upload ${name} : ${error.message}`);
  uploaded.push(path);
  return path;
}

async function callApi(route, payload) {
  const res = await fetch(`${BASE}/api/idv/${route}`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${SECRET}`,
      "content-type": "application/json",
    },
    body: JSON.stringify(payload),
  });
  const json = await res.json();
  if (!res.ok || json.ok === false) {
    throw new Error(`${route} : HTTP ${res.status} ${JSON.stringify(json)}`);
  }
  return json;
}

// Seuils = valeurs par défaut du mode « standard ».
const THRESHOLDS = {
  face_match_approve: 0.6,
  face_match_reject: 0.35,
  liveness_min: 0.7,
  doc_confidence_min: 0.6,
};

try {
  console.log(`cible : ${BASE}\n`);

  const face = await sampleFace(
    "sample-face.jpg",
    "https://raw.githubusercontent.com/opencv/opencv/4.x/samples/data/lena.jpg"
  );
  const other = await sampleFace(
    "other-face.jpg",
    "https://raw.githubusercontent.com/opencv/opencv/4.x/samples/data/messi5.jpg"
  );

  // ── 1) Document VALIDE (expire en 2032) ──────────────────────────────────
  const validMrz = buildTd1(
    "D23145890",
    "900512",
    "M",
    "320415",
    "DZA",
    "BENALI",
    "KARIM"
  );
  const parsedLocal = parseMrz(validMrz);
  ok(
    "fixture : MRZ TD1 générée avec des checksums VALIDES",
    parsedLocal?.valid === true,
    parsedLocal ? JSON.stringify(parsedLocal.checks) : "parse null"
  );

  const card = await buildCard(face, validMrz);
  const frontPath = await put("doc-front.jpg", card.front);
  const backPath = await put("doc-back.jpg", card.back);

  const doc = await callApi("analyze-document", {
    frontPath,
    backPath,
    mrzFormat: "td1",
  });
  const check = (k) => doc.checks.find((c) => c.key === k);
  ok(
    "document : portrait détecté sur le recto",
    check("doc_face")?.status === "passed",
    `score ${check("doc_face")?.score}`
  );
  ok(
    "document : MRZ lue et checksums valides",
    check("mrz")?.status === "passed",
    `score ${check("mrz")?.score}`
  );
  ok(
    "document : non expiré",
    check("doc_expiry")?.status === "passed",
    `expiration ${doc.documentExpiresAt}`
  );
  ok(
    "document : identité extraite",
    doc.extracted?.surname === "BENALI" &&
      doc.extracted?.given_names === "KARIM" &&
      doc.extracted?.document_number === "D23145890",
    JSON.stringify(doc.extracted ?? {})
  );

  // ── 2) Selfie de la MÊME personne → face match élevé ─────────────────────
  const selfie = await sharp(face)
    .resize(720)
    .modulate({ brightness: 0.92 })
    .jpeg({ quality: 92 })
    .toBuffer();
  const selfiePath = await put("selfie.jpg", selfie);

  const match = await callApi("face-match", { docPath: frontPath, selfiePath });
  ok(
    "face match : portrait de la carte ↔ selfie → score élevé",
    match.score >= THRESHOLDS.face_match_approve,
    `cos ${match.cosine} → score ${match.score}`
  );

  // ── 3) IMPOSTEUR → refus automatique ────────────────────────────────────
  const impostorPath = await put(
    "impostor.jpg",
    await sharp(other).resize(720).jpeg({ quality: 92 }).toBuffer()
  );
  const bad = await callApi("face-match", {
    docPath: frontPath,
    selfiePath: impostorPath,
  });
  ok(
    "face match : imposteur → score sous le seuil de refus",
    bad.score < THRESHOLDS.face_match_reject,
    `cos ${bad.cosine} → score ${bad.score}`
  );
  ok(
    "décision : imposteur → REFUS automatique",
    decideIdv({
      thresholds: THRESHOLDS,
      scores: { face_match: bad.score, liveness: 1, doc_confidence: 0.9 },
      livenessRequired: true,
    }).outcome === "reject"
  );

  // ── 4) ATTAQUE PAR PHOTO : 3 frames statiques → liveness refusé ──────────
  const staticFrames = [];
  for (let i = 0; i < 3; i++) {
    staticFrames.push(
      await put(
        `replay-${i}.jpg`,
        await sharp(face)
          .resize(720, 960, { fit: "contain", background: "#222" })
          .jpeg({ quality: 90 })
          .toBuffer()
      )
    );
  }
  const frames = await callApi("analyze-selfie", { paths: staticFrames });
  const liveness = evaluateLiveness(
    ["center", "turn_left", "closer"],
    frames.frames.map((f) => f.face)
  );
  ok(
    "attaque par photo : liveness REFUSÉ (aucun défi accompli)",
    !liveness.passed && liveness.score < THRESHOLDS.liveness_min,
    `score ${liveness.score} · ${liveness.verdicts
      .filter((v) => !v.passed)
      .map((v) => v.reason)
      .join(", ")}`
  );
  ok(
    "décision : bon visage mais liveness refusé → PAS d'approbation auto",
    decideIdv({
      thresholds: THRESHOLDS,
      scores: {
        face_match: match.score,
        liveness: liveness.score,
        doc_confidence: 0.9,
      },
      livenessRequired: true,
    }).outcome !== "approve"
  );

  // ── 5) Document EXPIRÉ → refus malgré un visage parfait ──────────────────
  const expiredMrz = buildTd1(
    "D23145890",
    "900512",
    "M",
    "200415", // expiré en 2020
    "DZA",
    "BENALI",
    "KARIM"
  );
  const expiredCard = await buildCard(face, expiredMrz);
  const expFront = await put("exp-front.jpg", expiredCard.front);
  const expBack = await put("exp-back.jpg", expiredCard.back);
  const expDoc = await callApi("analyze-document", {
    frontPath: expFront,
    backPath: expBack,
    mrzFormat: "td1",
  });
  const expCheck = expDoc.checks.find((c) => c.key === "doc_expiry");
  ok(
    "document expiré : détecté par le pipeline",
    expCheck?.status === "failed",
    `expiration ${expDoc.documentExpiresAt}`
  );
  ok(
    "décision : document expiré + visage parfait → REFUS (policy par défaut)",
    decideIdv({
      thresholds: THRESHOLDS,
      scores: { face_match: match.score, liveness: 1, doc_confidence: 0.95 },
      documentExpired: true,
      livenessRequired: true,
    }).outcome === "reject"
  );

  // ── 6) Parcours NOMINAL complet → approbation automatique ────────────────
  ok(
    "décision : document conforme + même personne + liveness OK → APPROBATION auto",
    decideIdv({
      thresholds: THRESHOLDS,
      scores: { face_match: match.score, liveness: 1, doc_confidence: 0.9 },
      checks: [
        { key: "mrz", status: "passed", score: 1 },
        { key: "doc_expiry", status: "passed", score: 1 },
        { key: "face_match", status: "passed", score: match.score },
      ],
      livenessRequired: true,
    }).outcome === "approve"
  );

  // ── 7) Routes internes : aucune fuite sans secret ────────────────────────
  for (const route of ["analyze-document", "analyze-selfie", "face-match"]) {
    const res = await fetch(`${BASE}/api/idv/${route}`, {
      method: "POST",
      body: "{}",
    });
    ok(
      `route ${route} : refusée sans secret`,
      res.status === 401,
      `HTTP ${res.status}`
    );
  }
} catch (e) {
  console.error(`\n❌ ERREUR : ${e.message}`);
  fail++;
} finally {
  if (uploaded.length) {
    await admin.storage.from(BUCKET).remove(uploaded);
    console.log(`\n🧹 ${uploaded.length} fichier(s) de test supprimé(s)`);
  }
}

console.log(`\n${fail === 0 ? "✅" : "❌"} ${pass} OK / ${fail} KO`);
process.exit(fail === 0 ? 0 : 1);
