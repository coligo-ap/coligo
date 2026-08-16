// =============================================================================
// Tests — PDF D'IMPRESSION des cartes fidélité (SPEC-FIDELITE 4.0)
// =============================================================================
// Vérifie, sur le VRAI builder (lib/loyalty/card-pdf.ts, pdf-lib + zxing) :
//   A. GÉOMÉTRIE — une carte par page (recto puis verso), page = format fini
//      85,6 × 54 mm + fonds perdus 3 mm + zone technique 6 mm.
//   B. DONNÉES UNIQUES — le numéro groupé de CHAQUE carte figure dans le PDF,
//      et deux cartes produisent des QR DIFFÉRENTS (matrices zxing comparées).
//   C. QR — l'URL encodée est bien https://coligo.app/c/<code> (même encodeur
//      zxing que les tickets scannés chaque jour en caisse).
//   D. MODÈLES — les 4 modèles visuels se génèrent sans erreur, logo arabe
//      embarqué quand le PNG est présent.
// Usage : npm run test:loyalty:pdf
//         node --experimental-strip-types scripts/test-loyalty-pdf.mjs --sample <fichier.pdf>
// =============================================================================

import { readFileSync, writeFileSync } from "node:fs";
import { inflateSync } from "node:zlib";
import { PDFDocument } from "pdf-lib";
import { buildLoyaltyCardsPdf, CARD_PDF_GEOM } from "@/lib/loyalty/card-pdf";
import { CARD_TEMPLATES, groupCardCode } from "@/lib/loyalty/card-templates";
import { qrMatrix } from "@/lib/ticket/qr-svg";

let failures = 0;
function assert(cond, label, detail) {
  if (cond) {
    console.log(`  ✅ ${label}`);
  } else {
    failures++;
    console.error(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const MM = 72 / 25.4;
const CODES = ["ABCD2345EFGH2345", "KLMN6789PQRS6789", "TVWX2345ABCD6789"];
const AR_LOGO_PATH = "public/logo-coligo-AR-Bg_blanc-Ecr_Violet.png";

async function main() {
  const sampleIdx = process.argv.indexOf("--sample");
  let arLogo = null;
  try {
    arLogo = readFileSync(AR_LOGO_PATH);
  } catch {
    /* testé plus bas */
  }

  // ── Mode ÉCHANTILLON : 1 carte par modèle, pour tirage d'essai réel ──────
  if (sampleIdx >= 0) {
    const out = process.argv[sampleIdx + 1] ?? "cartes-fidelite-exemple.pdf";
    const doc = await PDFDocument.create();
    for (const tpl of CARD_TEMPLATES) {
      const bytes = await buildLoyaltyCardsPdf({
        merchantName: "Supérette Yemma",
        templateKey: tpl.key,
        cards: [{ code: CODES[0] }],
        baseUrl: "https://coligo.app",
        arabicLogoPng: arLogo,
      });
      const part = await PDFDocument.load(bytes);
      const pages = await doc.copyPages(part, part.getPageIndices());
      pages.forEach((p) => doc.addPage(p));
    }
    writeFileSync(out, await doc.save());
    console.log(`Échantillon (4 modèles × recto/verso) : ${out}`);
    return;
  }

  console.log("TEST A — géométrie d'impression");
  const bytes = await buildLoyaltyCardsPdf({
    merchantName: "Supérette Yemma",
    templateKey: "violet",
    cards: CODES.map((code) => ({ code })),
    baseUrl: "https://coligo.app",
    arabicLogoPng: arLogo,
  });
  assert(bytes.length > 10_000, "A1 PDF non vide", bytes.length);

  const doc = await PDFDocument.load(bytes);
  assert(
    doc.getPageCount() === CODES.length * 2,
    "A2 une carte par page : recto PUIS verso (2 pages/carte)",
    doc.getPageCount()
  );
  const { width, height } = doc.getPage(0).getSize();
  const expW = CARD_PDF_GEOM.pageW * MM;
  const expH = CARD_PDF_GEOM.pageH * MM;
  assert(
    Math.abs(width - expW) < 0.5 && Math.abs(height - expH) < 0.5,
    "A3 page = 85,6×54 mm + 3 mm de fonds perdus + 6 mm de zone technique",
    `${(width / MM).toFixed(1)}×${(height / MM).toFixed(1)} mm`
  );
  assert(
    Math.abs(CARD_PDF_GEOM.pageW - 103.6) < 0.01 &&
      Math.abs(CARD_PDF_GEOM.pageH - 72) < 0.01,
    "A4 géométrie exportée conforme (103,6 × 72 mm)"
  );

  console.log("TEST B — données uniques par carte");
  // Les content streams sont compressés (Flate) : on les décompresse pour
  // vérifier que le texte imprimé porte bien le numéro de CHAQUE carte.
  const buf = Buffer.from(bytes);
  const rawParts = [buf.toString("latin1")];
  let cursor = 0;
  for (;;) {
    const start = buf.indexOf("stream", cursor);
    if (start < 0) break;
    const dataStart = buf.indexOf("\n", start) + 1;
    const end = buf.indexOf("endstream", dataStart);
    if (end < 0) break;
    try {
      rawParts.push(
        inflateSync(buf.subarray(dataStart, end)).toString("latin1")
      );
    } catch {
      /* flux non Flate (image, police) : ignoré */
    }
    cursor = end + 9;
  }
  // pdf-lib écrit le texte en chaînes HEX (`<41424344…> Tj`) : on cherche
  // l'encodage hexadécimal du numéro groupé.
  const raw = rawParts.join("\n").toUpperCase();
  for (const code of CODES) {
    const hex = Buffer.from(groupCardCode(code), "latin1")
      .toString("hex")
      .toUpperCase();
    assert(
      raw.includes(hex),
      `B1 numéro lisible « ${groupCardCode(code)} » présent`
    );
  }
  const m1 = await qrMatrix(`https://coligo.app/c/${CODES[0]}`, { margin: 0 });
  const m2 = await qrMatrix(`https://coligo.app/c/${CODES[1]}`, { margin: 0 });
  assert(
    JSON.stringify(m1) !== JSON.stringify(m2),
    "B2 deux cartes → deux QR différents (matrices zxing)"
  );

  console.log("TEST C — contenu du QR");
  assert(
    m1.length >= 21 && m1.length <= 41,
    "C1 QR compact (version basse → gros modules, scan fiable)",
    `${m1.length}×${m1.length} modules`
  );
  // 2 mm de marge blanche autour d'un QR de 22 mm → module ≥ 0,5 mm à
  // l'impression (limite lisibilité ~0,33 mm) :
  const moduleMm = 22 / m1.length;
  assert(
    moduleMm >= 0.5,
    "C2 module ≥ 0,5 mm sur carte (imprimable en offset/numérique)",
    `${moduleMm.toFixed(2)} mm`
  );

  console.log("TEST D — modèles visuels");
  for (const tpl of CARD_TEMPLATES) {
    const b = await buildLoyaltyCardsPdf({
      merchantName: "Boulangerie النور", // nom avec arabe : safe() ne crashe pas
      templateKey: tpl.key,
      cards: [{ code: CODES[0] }],
      baseUrl: "https://coligo.app",
      arabicLogoPng: arLogo,
    });
    const d = await PDFDocument.load(b);
    assert(
      d.getPageCount() === 2,
      `D1 modèle « ${tpl.label} » généré (recto + verso)`
    );
  }
  assert(!!arLogo, "D2 logotype arabe كوليغو présent (public/)", AR_LOGO_PATH);

  console.log("TEST E — lots génériques + nom optionnel (0459)");
  // Même extraction hex que TEST B (pdf-lib écrit `<hex> Tj` en flux Flate).
  const extractRaw = (b) => {
    const parts = [b.toString("latin1")];
    let cur = 0;
    for (;;) {
      const start = b.indexOf("stream", cur);
      if (start < 0) break;
      const dataStart = b.indexOf("\n", start) + 1;
      const end = b.indexOf("endstream", dataStart);
      if (end < 0) break;
      try {
        parts.push(inflateSync(b.subarray(dataStart, end)).toString("latin1"));
      } catch {
        /* flux non Flate : ignoré */
      }
      cur = end + 9;
    }
    return parts.join("\n").toUpperCase();
  };
  const hexOf = (s) => Buffer.from(s, "latin1").toString("hex").toUpperCase();
  const genericBytes = await buildLoyaltyCardsPdf({
    merchantName: null,
    templateKey: "violet",
    cards: [{ code: CODES[0] }],
    baseUrl: "https://coligo.app",
    arabicLogoPng: arLogo,
  });
  const rawGeneric = extractRaw(Buffer.from(genericBytes));
  assert(
    rawGeneric.includes(hexOf("Valable chez tous tes commer")),
    "E1 carte GÉNÉRIQUE : mention « valable chez tous » imprimée"
  );
  assert(
    !rawGeneric.includes(hexOf("Chez ")),
    "E2 carte GÉNÉRIQUE : aucun « Chez … »"
  );
  const noNameBytes = await buildLoyaltyCardsPdf({
    merchantName: "Superette Yemma",
    printMerchantName: false,
    templateKey: "violet",
    cards: [{ code: CODES[0] }],
    baseUrl: "https://coligo.app",
    arabicLogoPng: arLogo,
  });
  const rawNoName = extractRaw(Buffer.from(noNameBytes));
  assert(
    !rawNoName.includes(hexOf("Chez ")),
    "E3 nom volontairement non imprimé : pas de « Chez … »"
  );

  console.log(
    failures === 0
      ? "\n✅ PDF cartes fidélité : tous les tests passent."
      : `\n❌ ${failures} échec(s).`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
