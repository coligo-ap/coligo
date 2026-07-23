// =============================================================================
// IDV — CALIBRATION RÉELLE du face match (le test qui dit si la vérification
// automatique est JUSTE).
//
// Le banc test-idv-pipeline.mjs prouve que le pipeline FONCTIONNE (le modèle
// tourne, l'alignement recale, les checksums tombent juste). Il ne prouve PAS
// qu'il DÉCIDE juste : ses paires « même personne » sont la même photo dégradée,
// et son unique imposteur est un homme comparé à une femme. Deux populations qui
// ne se ressemblent pas : n'importe quel seuil les sépare.
//
// Ici on mesure ce qui compte vraiment, sur le corpus multi-identités
// (scripts/idv-corpus.mjs — photos DIFFÉRENTES de la même personne, licences
// commerciales vérifiées) :
//
//   • FAR (False Accept Rate) — un IMPOSTEUR approuvé automatiquement.
//     C'est la faute grave : un compte livreur ouvert avec les papiers d'un
//     autre. Exigence : ZÉRO.
//   • FRR (False Reject Rate) — une personne LÉGITIME refusée automatiquement.
//     C'est l'injustice : un livreur honnête enfermé dehors. Exigence : ZÉRO
//     (le doute doit aller en revue humaine, jamais au refus).
//   • La ZONE DE REVUE — ce qu'on n'a pas su trancher seul, et qu'on assume.
//
// Les paires imitent la production : « document » = portrait recadré, réduit et
// recompressé (ce qu'est une photo d'ID) ; « selfie » = l'AUTRE photo de la même
// personne. Les imposteurs sont tirés en priorité dans la même cohorte (même
// sexe, morphologie proche) — ce sont eux qui font tomber un système, pas deux
// personnes que tout oppose.
//
//   node --experimental-strip-types scripts/test-idv-calibration.mjs
// =============================================================================
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import sharp from "sharp";
import { getIdvSession } from "../lib/idv/pipeline/onnx.ts";
import { decodeImage } from "../lib/idv/pipeline/image.ts";
import { cosineSimilarity } from "../lib/idv/pipeline/sface.ts";
import {
  findBestFace,
  findFaceUpright,
  embedFoundFace,
} from "../lib/idv/pipeline/face-embed.ts";
import {
  normalizeFaceScore,
  COS_FLOOR,
  COS_CEIL,
} from "../lib/idv/face-match.ts";
import { decideIdv } from "../lib/idv/decision.ts";

// Corpus construit par scripts/idv-corpus.mjs (jamais commité : dossier temp).
// Chemin recopié ici — importer le builder EXÉCUTERAIT sa construction.
const MANIFEST = join(tmpdir(), "coligo-idv-corpus", "manifest.json");

// Seuils de PRODUCTION (idv_modes, mode « standard »).
const THRESHOLDS = {
  face_match_approve: 0.6,
  face_match_reject: 0.35,
  liveness_min: 0.7,
  doc_confidence_min: 0.6,
};

if (!existsSync(MANIFEST)) {
  console.error(
    "❌ Corpus absent — lancer d'abord : node --experimental-strip-types scripts/idv-corpus.mjs"
  );
  process.exit(1);
}
const { identities } = JSON.parse(readFileSync(MANIFEST, "utf8"));

const { session: yunet } = await getIdvSession("yunet");
const { session: sface } = await getIdvSession("sface");

/** Embedding par le chemin de PRODUCTION (cascade + recalage + miroir). */
async function embed(buf, upright = false) {
  const img = await decodeImage(buf, 1280);
  const found = upright
    ? await findFaceUpright(yunet, img).then((f) =>
        f ? { image: img, face: f.face, pass: f.pass } : null
      )
    : await findBestFace(yunet, img);
  if (!found) return null;
  return embedFoundFace(sface, found);
}

/**
 * Simule le PORTRAIT D'UN DOCUMENT à partir d'une photo : on recadre le visage
 * (comme sur une carte), on le réduit à la taille d'une photo d'identité
 * imprimée, on l'éclaircit et on le recompresse fort. C'est exactement ce que
 * le pipeline reçoit quand un livreur photographie sa carte.
 */
async function asDocumentPortrait(file) {
  const img = await decodeImage(readFileSync(file), 1280);
  const found = await findBestFace(yunet, img);
  if (!found) return null;
  const { face } = found;
  const pad = Math.max(face.w, face.h) * 0.45;
  const left = Math.max(0, Math.round(face.x - pad));
  const top = Math.max(0, Math.round(face.y - pad * 1.2));
  const width = Math.min(img.width - left, Math.round(face.w + pad * 2));
  const height = Math.min(img.height - top, Math.round(face.h + pad * 2.2));
  if (width < 40 || height < 40) return null;
  return sharp(img.data, {
    raw: { width: img.width, height: img.height, channels: 3 },
  })
    .extract({ left, top, width, height })
    .resize(170) // portrait d'ID imprimé : ~170 px de large
    .modulate({ brightness: 1.12, saturation: 0.65 })
    .jpeg({ quality: 55 })
    .toBuffer();
}

/** Selfie réaliste : léger sous-éclairage + compression réseau mobile. */
const asSelfie = (file) =>
  sharp(readFileSync(file))
    .modulate({ brightness: 0.92 })
    .jpeg({ quality: 80 })
    .toBuffer();

/**
 * SESSION selfie : les 3 frames des défis de présence. Même visage, même
 * instant, mais chaque frame a son bruit propre — main qui bouge, exposition
 * qui respire, compression qui varie. C'est ce que le serveur reçoit vraiment,
 * et c'est ce qui permet de MOYENNER le bruit au lieu de le subir.
 */
const SESSION_FRAMES = [
  { rotate: 0, brightness: 0.92, quality: 80, blur: 0 },
  { rotate: -4, brightness: 1.03, quality: 62, blur: 0.6 },
  { rotate: 5, brightness: 0.85, quality: 74, blur: 0 },
];

async function selfieSession(file) {
  const src = readFileSync(file);
  return Promise.all(
    SESSION_FRAMES.map(async (f) => {
      let img = sharp(src).modulate({ brightness: f.brightness });
      if (f.rotate) img = img.rotate(f.rotate, { background: "#222" });
      if (f.blur) img = img.blur(f.blur);
      return img.jpeg({ quality: f.quality }).toBuffer();
    })
  );
}

console.log("Préparation des visages (portraits « document » + selfies)…\n");

const people = [];
for (const id of identities) {
  const photos = [];
  for (const photo of id.photos) {
    const docBuf = await asDocumentPortrait(photo.file);
    const doc = docBuf ? await embed(docBuf) : null;
    const session = (
      await Promise.all(
        (await selfieSession(photo.file)).map((buf) => embed(buf, true))
      )
    ).filter(Boolean);
    if (doc && session.length) photos.push({ src: photo.title, doc, session });
  }
  if (photos.length >= 2)
    people.push({ key: id.key, cohort: id.cohort, photos });
  console.log(
    `  ${id.key.padEnd(10)} ${photos.length} photo(s) exploitable(s) (portrait doc + session ${photos[0]?.session.length ?? 0} frames)`
  );
}

// ── Stratégies de comparaison document ↔ SESSION selfie ─────────────────────
// C'est LE choix qui décide de la justesse : que fait-on des 3 frames ?
//   • frame     : on ne regarde que la première (l'information des autres est
//                 jetée) ;
//   • max       : on garde la meilleure — ce que fait la production aujourd'hui.
//                 Piège : le maximum de N tirages monte AUSSI pour un imposteur
//                 (plus on tire, plus on a de chances de tomber sur une vue qui
//                 lui ressemble) ;
//   • gabarit   : on MOYENNE les embeddings des frames (puis re-normalise). Le
//                 bruit de capture s'annule, le visage reste. C'est la méthode
//                 des systèmes biométriques sérieux (matching par « template »).
const l2mean = (embs) => {
  const out = new Float32Array(embs[0].length);
  for (const e of embs) for (let i = 0; i < e.length; i++) out[i] += e[i];
  let n = 0;
  for (let i = 0; i < out.length; i++) n += out[i] ** 2;
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < out.length; i++) out[i] /= n;
  return out;
};

const STRATEGIES = {
  frame: (doc, session) => cosineSimilarity(doc, session[0]),
  max: (doc, session) =>
    Math.max(...session.map((f) => cosineSimilarity(doc, f))),
  gabarit: (doc, session) => cosineSimilarity(doc, l2mean(session)),
};

/** Toutes les paires, tous les scores : on ne mesure qu'UNE fois. */
const genuinePairs = [];
for (const p of people) {
  for (const a of p.photos) {
    for (const b of p.photos) {
      if (a.src === b.src) continue; // jamais la même photo des deux côtés
      genuinePairs.push({ person: p.key, doc: a.doc, session: b.session });
    }
  }
}
const impostorPairs = [];
for (const a of people) {
  for (const b of people) {
    if (a.key === b.key) continue;
    for (const photo of b.photos) {
      impostorPairs.push({
        person: `${a.key}/${b.key}`,
        hard: a.cohort === b.cohort,
        doc: a.photos[0].doc,
        session: photo.session,
      });
    }
  }
}

const score = (strategy, pairs) =>
  pairs.map((p) => ({ ...p, cos: STRATEGIES[strategy](p.doc, p.session) }));

// ── Statistiques ─────────────────────────────────────────────────────────────
const stats = (xs) => {
  const s = [...xs].sort((a, b) => a - b);
  const q = (p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
  return {
    n: s.length,
    min: s[0],
    p05: q(0.05),
    med: q(0.5),
    p95: q(0.95),
    max: s[s.length - 1],
  };
};
const f = (x) => x.toFixed(3);
const pct = (n, total) => `${((100 * n) / total).toFixed(1)} %`;

const outcome = (cos) =>
  decideIdv({
    thresholds: THRESHOLDS,
    scores: {
      face_match: normalizeFaceScore(cos),
      liveness: 1,
      doc_confidence: 0.9,
    },
    livenessRequired: true,
  }).outcome;

const tally = (rows) => {
  const t = { approve: 0, review: 0, reject: 0 };
  for (const r of rows) t[outcome(r.cos)]++;
  return t;
};

// Les seuils NORMALISÉS de la DB, ramenés en cosinus : c'est dans cette
// unité-là qu'on peut les comparer aux mesures.
const toCos = (s) => COS_FLOOR + s * (COS_CEIL - COS_FLOOR);
const REJECT_COS = toCos(THRESHOLDS.face_match_reject);
const APPROVE_COS = toCos(THRESHOLDS.face_match_approve);

console.log(
  `\n── COMPARAISON DES STRATÉGIES (${genuinePairs.length} paires légitimes, ${impostorPairs.length} imposteurs)`
);
console.log(
  `   seuils : refus sous cos ${f(REJECT_COS)} · approbation dès cos ${f(APPROVE_COS)}\n`
);

const results = {};
for (const name of Object.keys(STRATEGIES)) {
  const g = score(name, genuinePairs);
  const i = score(name, impostorPairs);
  const gs = stats(g.map((x) => x.cos));
  const is = stats(i.map((x) => x.cos));
  const gt = tally(g);
  const it = tally(i);
  results[name] = { g, i, gs, is, gt, it };
  console.log(`  ${name.toUpperCase()}`);
  console.log(
    `    légitimes  médiane ${f(gs.med)}  pire ${f(gs.min)}  │ approuvés ${pct(gt.approve, g.length).padStart(6)} · revue ${pct(gt.review, g.length).padStart(6)} · REFUSÉS ${pct(gt.reject, g.length)}`
  );
  console.log(
    `    imposteurs médiane ${f(is.med)}  pire ${f(is.max)}  │ APPROUVÉS ${pct(it.approve, i.length).padStart(6)} · revue ${pct(it.review, i.length).padStart(6)} · refusés ${pct(it.refuse ?? it.reject, i.length)}`
  );
  console.log(
    `    marge sûreté  approbation − pire imposteur = ${f(APPROVE_COS - is.max)}   │  pire légitime − refus = ${f(gs.min - REJECT_COS)}\n`
  );
}

// ── Verdicts sur la stratégie de PRODUCTION ─────────────────────────────────
const PROD = "gabarit";
const { g, i, gs, is, gt, it } = results[PROD];

let pass = 0;
let fail = 0;
const ok = (label, cond, extra = "") => {
  console.log(`${cond ? "✅" : "❌"} ${label}${extra ? ` — ${extra}` : ""}`);
  cond ? pass++ : fail++;
};

console.log(`── VERDICTS (stratégie de production : ${PROD}) ────────────────`);

// SÛRETÉ — aucun imposteur ne franchit l'approbation automatique. Un compte
// ouvert avec les papiers d'un autre est la faute qu'on ne rattrape jamais.
const falseAccepts = i.filter((x) => outcome(x.cos) === "approve");
ok(
  "FAR = 0 : aucun imposteur approuvé automatiquement",
  falseAccepts.length === 0,
  falseAccepts.length
    ? `${falseAccepts.length} : ${falseAccepts
        .slice(0, 3)
        .map((x) => `${x.person} cos ${f(x.cos)}`)
        .join(", ")}`
    : `pire imposteur cos ${f(is.max)} — marge ${f(APPROVE_COS - is.max)} sous le seuil`
);

// JUSTICE — la machine ne refuse JAMAIS seule quelqu'un de légitime. Le doute
// appartient à la revue humaine, pas au refus.
const falseRejects = g.filter((x) => outcome(x.cos) === "reject");
ok(
  "FRR = 0 : aucune personne légitime refusée automatiquement",
  falseRejects.length === 0,
  falseRejects.length
    ? `${falseRejects.length}/${g.length} : ${falseRejects
        .slice(0, 3)
        .map((x) => `${x.person} cos ${f(x.cos)}`)
        .join(", ")}`
    : `pire cas légitime cos ${f(gs.min)} — marge ${f(gs.min - REJECT_COS)} au-dessus du refus`
);

// Les seuils doivent garder une marge : calibrés AU RAS des mesures, ils
// casseraient au premier visage un peu différent des 13 du corpus.
ok(
  "Marge de sûreté ≥ 0.10 entre le pire imposteur et l'approbation",
  APPROVE_COS - is.max >= 0.1,
  `${f(APPROVE_COS - is.max)} (pire imposteur ${f(is.max)}, approbation ${f(APPROVE_COS)})`
);
ok(
  "Marge de justice ≥ 0.03 entre le refus et le pire cas légitime",
  gs.min - REJECT_COS >= 0.03,
  `${f(gs.min - REJECT_COS)} (refus ${f(REJECT_COS)}, pire légitime ${f(gs.min)})`
);

// Un système qui n'approuve presque personne seul n'automatise rien.
ok(
  "Automatisation utile : ≥ 70 % des légitimes approuvés sans humain",
  gt.approve / g.length >= 0.7,
  pct(gt.approve, g.length)
);

// Le gabarit doit battre le « max » de la production précédente : c'est la
// raison même du changement.
ok(
  "Le gabarit fait mieux que « la meilleure frame » sur les imposteurs",
  results.gabarit.is.max <= results.max.is.max,
  `pire imposteur : max ${f(results.max.is.max)} → gabarit ${f(results.gabarit.is.max)}`
);

console.log(`\n${pass} OK · ${fail} KO`);
process.exit(fail ? 1 : 0);
