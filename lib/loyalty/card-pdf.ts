import {
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import { PDF_INK, pdfColor, safe } from "@/lib/pdf/pdf-kit";
import { LOYALTY_CARD } from "@/lib/design/tokens";
import { qrMatrix } from "@/lib/ticket/qr-svg";
import {
  CARD_WAVE_BACK,
  CARD_WAVE_FRONT,
  getCardTemplate,
  groupCardCode,
} from "@/lib/loyalty/card-templates";

// =============================================================================
// PDF D'IMPRESSION des cartes de fidélité (SPEC-FIDELITE 4.0) — pdf-lib
// serveur, jamais window.print. UNE CARTE PAR PAGE (recto puis verso, pour
// l'impression recto/verso du sous-traitant), format CR80 85,6 × 54 mm,
// FONDS PERDUS 3 mm + TRAITS DE COUPE dans une zone technique de 6 mm.
// Le QR encode l'URL publique /c/<code> (même encodeur zxing que les tickets
// scannés en prod) ; le numéro est imprimé en clair, groupé par 4 (saisie
// manuelle de secours). Le PDF n'est JAMAIS stocké : régénéré à la volée
// depuis la base (patron des contrats).
// =============================================================================

const M = 72 / 25.4; // 1 mm en points PDF
const mm = (n: number) => n * M;

export const CARD_PDF_GEOM = {
  trimW: 85.6,
  trimH: 54,
  bleed: 3,
  slug: 6,
  /** Taille de page totale (mm). */
  get pageW() {
    return this.trimW + 2 * (this.bleed + this.slug);
  },
  get pageH() {
    return this.trimH + 2 * (this.bleed + this.slug);
  },
  /** Décalage du coin bas-gauche du format FINI dans la page (mm). */
  get origin() {
    return this.bleed + this.slug;
  },
};

export type CardPdfInput = {
  /** Vide/absent = carte GÉNÉRIQUE Coligo (valable chez tous). */
  merchantName?: string | null;
  /** false = ne pas imprimer « Chez X » même si un commerçant est rattaché. */
  printMerchantName?: boolean;
  templateKey: string;
  cards: { code: string }[];
  /** Origine publique STABLE (les cartes vivent des années) — ex. https://coligo.app */
  baseUrl: string;
  /** PNG du logotype arabe كوليغو (fond blanc) — optionnel mais recommandé. */
  arabicLogoPng?: Uint8Array | null;
};

type Ctx = {
  fonts: { reg: PDFFont; bold: PDFFont; mono: PDFFont };
  arLogo: PDFImage | null;
  tpl: ReturnType<typeof getCardTemplate>;
  /** Nom imprimé sur la carte — null = générique (« tous tes commerçants »). */
  displayName: string | null;
};

// Encres partagées des documents (lib/design/tokens + pdf-kit) — zéro valeur
// posée ici.
const BLACK = pdfColor(LOYALTY_CARD.qrInk);
const WHITE = pdfColor(LOYALTY_CARD.paper);
const INK = PDF_INK.INK;
const MUTED = PDF_INK.MUTED;

function fitSize(
  text: string,
  font: PDFFont,
  start: number,
  maxWidth: number,
  min = 5
): number {
  let size = start;
  while (size > min && font.widthOfTextAtSize(text, size) > maxWidth) {
    size -= 0.25;
  }
  return size;
}

function wrap(
  text: string,
  font: PDFFont,
  size: number,
  maxWidth: number,
  maxLines = 3
): string[] {
  const words = text.split(/\s+/);
  const lines: string[] = [];
  let line = "";
  for (const w of words) {
    const probe = line ? `${line} ${w}` : w;
    if (font.widthOfTextAtSize(probe, size) <= maxWidth) {
      line = probe;
    } else {
      if (line) lines.push(line);
      line = w;
      if (lines.length === maxLines - 1) break;
    }
  }
  if (line && lines.length < maxLines) lines.push(line);
  return lines;
}

/** Traits de coupe : hairlines alignées sur le format FINI, tracées AU-DELÀ
 *  des fonds perdus (zone technique) — jamais dans l'image. */
function drawCropMarks(page: PDFPage) {
  const g = CARD_PDF_GEOM;
  const o = g.origin;
  const len = 4;
  const gap = g.bleed + 1; // départ : 1 mm après la zone de fonds perdus
  const xs = [o, o + g.trimW];
  const ys = [o, o + g.trimH];
  const line = (x1: number, y1: number, x2: number, y2: number) =>
    page.drawLine({
      start: { x: mm(x1), y: mm(y1) },
      end: { x: mm(x2), y: mm(y2) },
      thickness: 0.3,
      color: BLACK,
    });
  for (const y of ys) {
    line(o - gap - len, y, o - gap, y); // gauche
    line(o + g.trimW + gap, y, o + g.trimW + gap + len, y); // droite
  }
  for (const x of xs) {
    line(x, o - gap - len, x, o - gap); // bas
    line(x, o + g.trimH + gap, x, o + g.trimH + gap + len); // haut
  }
}

/** Repères de page (n° carte / total) dans la zone technique, pour le façonnier. */
function drawSlugInfo(page: PDFPage, label: string, fonts: Ctx["fonts"]) {
  page.drawText(label, {
    x: mm(CARD_PDF_GEOM.origin),
    y: mm(1.6),
    size: 4.5,
    font: fonts.reg,
    color: MUTED,
  });
}

/** Rect plein posé en coordonnées « format fini » (origine = coin bas-gauche
 *  du format fini). */
function rect(
  page: PDFPage,
  x: number,
  y: number,
  w: number,
  h: number,
  color: ReturnType<typeof rgb>
) {
  const o = CARD_PDF_GEOM.origin;
  page.drawRectangle({
    x: mm(o + x),
    y: mm(o + y),
    width: mm(w),
    height: mm(h),
    color,
  });
}

function text(
  page: PDFPage,
  s: string,
  x: number,
  y: number,
  size: number,
  font: PDFFont,
  color: ReturnType<typeof rgb>
) {
  const o = CARD_PDF_GEOM.origin;
  page.drawText(s, { x: mm(o + x), y: mm(o + y), size, font, color });
}

function circle(
  page: PDFPage,
  cx: number,
  cy: number,
  r: number,
  color: ReturnType<typeof rgb>,
  opacity = 1
) {
  const o = CARD_PDF_GEOM.origin;
  page.drawEllipse({
    x: mm(o + cx),
    y: mm(o + cy),
    xScale: mm(r),
    yScale: mm(r),
    color,
    opacity,
  });
}

/** Rect à coins ARRONDIS (drawSvgPath — pdf-lib n'a pas de radius natif).
 *  Tracé en unités mm (scale = M), ancré coin bas-gauche format fini. */
function roundedRect(
  page: PDFPage,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
  color: ReturnType<typeof rgb>,
  opacity = 1
) {
  const p =
    `M ${r} 0 H ${w - r} Q ${w} 0 ${w} ${r} V ${h - r} ` +
    `Q ${w} ${h} ${w - r} ${h} H ${r} Q 0 ${h} 0 ${h - r} V ${r} Q 0 0 ${r} 0 Z`;
  const o = CARD_PDF_GEOM.origin;
  page.drawSvgPath(p, {
    x: mm(o + x),
    y: mm(o + y + h),
    scale: M,
    color,
    opacity,
  });
}

/** Pastille logotype arabe كوليغو : fond blanc (le PNG l'est déjà) + marge. */
function drawArabicChip(
  page: PDFPage,
  ctx: Ctx,
  x: number,
  y: number,
  h: number
) {
  if (!ctx.arLogo) return 0;
  const ratio = ctx.arLogo.width / ctx.arLogo.height;
  const w = h * ratio;
  const pad = 0.8;
  rect(page, x - pad, y - pad, w + 2 * pad, h + 2 * pad, WHITE);
  const o = CARD_PDF_GEOM.origin;
  page.drawImage(ctx.arLogo, {
    x: mm(o + x),
    y: mm(o + y),
    width: mm(w),
    height: mm(h),
  });
  return w + 2 * pad;
}

/** QR sur panneau blanc (zone de silence garantie par le padding). Runs
 *  horizontaux fusionnés → contenu compact, bords nets. */
function drawQr(
  page: PDFPage,
  matrix: boolean[][],
  panelX: number,
  panelY: number,
  panelSize: number,
  padding: number
) {
  roundedRect(page, panelX, panelY, panelSize, panelSize, 2, WHITE);
  const n = matrix.length;
  const qrSize = panelSize - 2 * padding;
  const cell = qrSize / n;
  const o = CARD_PDF_GEOM.origin;
  const left = o + panelX + padding;
  const top = o + panelY + padding + qrSize;
  for (let yy = 0; yy < n; yy++) {
    let run = -1;
    for (let xx = 0; xx <= n; xx++) {
      const on = xx < n && matrix[yy][xx];
      if (on && run < 0) run = xx;
      if (!on && run >= 0) {
        page.drawRectangle({
          x: mm(left + run * cell),
          y: mm(top - (yy + 1) * cell),
          width: mm((xx - run) * cell + 0.02),
          height: mm(cell + 0.02),
          color: BLACK,
        });
        run = -1;
      }
    }
  }
}

/* ----------------------------------- RECTO -------------------------------- */

function drawRecto(page: PDFPage, ctx: Ctx, code: string, matrix: boolean[][]) {
  const g = CARD_PDF_GEOM;
  const { tpl, fonts } = ctx;
  const bgColor = pdfColor(tpl.bg);
  const textColor = pdfColor(tpl.text);
  const subColor = pdfColor(tpl.subtext);

  // Fond jusqu'aux FONDS PERDUS + VAGUES du bas (langage marketplace) :
  // couche arrière subtile (encre du texte à 8 %) + vague d'accent pleine.
  rect(
    page,
    -g.bleed,
    -g.bleed,
    g.trimW + 2 * g.bleed,
    g.trimH + 2 * g.bleed,
    bgColor
  );
  const waveScale = mm(g.trimW + 2 * g.bleed) / 100;
  const waveX = mm(g.slug);
  const waveTop = mm(g.slug) + 30 * waveScale;
  page.drawSvgPath(CARD_WAVE_BACK, {
    x: waveX,
    y: waveTop,
    scale: waveScale,
    color: textColor,
    opacity: 0.08,
  });
  page.drawSvgPath(CARD_WAVE_FRONT, {
    x: waveX,
    y: waveTop,
    scale: waveScale,
    color: pdfColor(tpl.accent),
  });

  // Halo doux derrière la colonne de marque (flat premium, 5 % d'encre).
  circle(page, 16, 47, 24, textColor, 0.05);

  // Marque : « Coligo » vectoriel + pastille كوليغو (PNG blanc).
  text(page, "Coligo", 5, 45.2, 13, fonts.bold, textColor);
  const coligoW = fonts.bold.widthOfTextAtSize("Coligo", 13) / M; // pt → mm
  drawArabicChip(page, ctx, 5 + coligoW + 3, 44.6, 5.2);

  text(page, "C A R T E   F I D É L I T É", 5, 38.6, 5.2, fonts.reg, subColor);

  if (ctx.displayName) {
    const name = safe(`Chez ${ctx.displayName}`);
    const nameSize = fitSize(name, fonts.bold, 11.5, mm(48), 6.5);
    text(page, name, 5, 31.5, nameSize, fonts.bold, textColor);
  } else {
    // Carte GÉNÉRIQUE : valable chez tous les commerçants Coligo.
    text(
      page,
      "Valable chez tous tes commerçants.",
      5,
      31.8,
      5.6,
      fonts.reg,
      subColor
    );
  }

  // Puce de carte (métaphore bancaire, flat) : rect arrondi accent + fentes.
  roundedRect(page, 5, 20.4, 8, 5.6, 1.2, pdfColor(tpl.accent));
  rect(page, 6.4, 22.2, 5.2, 0.5, bgColor);
  rect(page, 6.4, 23.8, 5.2, 0.5, bgColor);

  // Posé SUR le disque d'accent (tous les accents sont soutenus) → blanc,
  // sinon illisible sur le modèle « Clair » (encre sur violet).
  text(page, "coligo.app", 5, 5.2, 6, fonts.bold, WHITE);

  // QR à droite : panneau blanc 26 mm + numéro lisible dessous.
  const panel = 26;
  const panelX = g.trimW - panel - 4.2;
  const panelY = 17.4;
  drawQr(page, matrix, panelX, panelY, panel, 2);
  const grouped = groupCardCode(code);
  const codeSize = fitSize(grouped, fonts.mono, 6, mm(panel + 4), 4.5);
  const codeW = fonts.mono.widthOfTextAtSize(grouped, codeSize) / M;
  text(
    page,
    grouped,
    panelX + panel / 2 - codeW / 2,
    12.2,
    codeSize,
    fonts.mono,
    // Posé SUR la vague d'accent (tous les accents sont soutenus) → blanc,
    // sinon illisible sur le modèle « Clair ».
    WHITE
  );

  drawCropMarks(page);
}

/* ----------------------------------- VERSO -------------------------------- */

function drawVerso(page: PDFPage, ctx: Ctx, index: number, total: number) {
  const g = CARD_PDF_GEOM;
  const { tpl, fonts } = ctx;
  const accent = pdfColor(tpl.versoAccent);

  // Verso CLAIR (lisibilité impression) + bandeau de marque.
  rect(
    page,
    -g.bleed,
    -g.bleed,
    g.trimW + 2 * g.bleed,
    g.trimH + 2 * g.bleed,
    WHITE
  );
  rect(page, -g.bleed, g.trimH - 8, g.trimW + 2 * g.bleed, 8 + g.bleed, accent);
  text(page, "Coligo", 5, 48.6, 8, fonts.bold, WHITE);
  drawArabicChip(
    page,
    ctx,
    5 + fonts.bold.widthOfTextAtSize("Coligo", 8) / M + 2.5,
    48.2,
    4
  );
  const tag = "CARTE FIDÉLITÉ";
  const tagW = fonts.reg.widthOfTextAtSize(tag, 5) / M;
  text(page, tag, g.trimW - tagW - 5, 48.9, 5, fonts.reg, WHITE);

  // Écho de vague en pied de verso (cohérence recto/verso, très léger).
  const vWaveScale = mm(g.trimW + 2 * g.bleed) / 100;
  page.drawSvgPath(CARD_WAVE_FRONT, {
    x: mm(g.slug),
    y: mm(g.slug) + 30 * vWaveScale,
    scale: vWaveScale,
    color: accent,
    opacity: 0.08,
  });

  // Colonne gauche : mode d'emploi en 3 étapes (spec 4.0).
  text(page, "Mode d'emploi", 5, 40.2, 6.5, fonts.bold, INK);
  const steps = [
    "Présente cette carte à la caisse à chaque achat.",
    ctx.displayName
      ? "Cumule du cashback et des bons chez ce commerçant."
      : "Cumule du cashback et des bons chez tes commerçants.",
    "Scanne le QR au recto pour créer ton compte et garder ton solde.",
  ];
  let y = 35.2;
  steps.forEach((s, i) => {
    circle(page, 6.8, y + 0.8, 2.1, accent);
    const numW = fonts.bold.widthOfTextAtSize(String(i + 1), 5.5) / M;
    text(page, String(i + 1), 6.8 - numW / 2, y - 0.9, 5.5, fonts.bold, WHITE);
    const lines = wrap(s, fonts.reg, 5.2, mm(34), 3);
    lines.forEach((l, j) => {
      text(page, l, 10.6, y - j * 2.6, 5.2, fonts.reg, INK);
    });
    y -= Math.max(lines.length * 2.6 + 3.4, 6.2);
  });

  // Colonne droite : services Coligo (l'argument d'acquisition).
  const colX = 49;
  text(page, "Avec Coligo", colX, 40.2, 6.5, fonts.bold, INK);
  const services = [
    "Retrait gratuit à l'avance — commande et passe sans file",
    "Livraison à domicile",
    "Cashback chez tes commerçants",
  ];
  let sy = 35.2;
  for (const s of services) {
    circle(page, colX + 1, sy + 0.7, 0.8, accent);
    const lines = wrap(s, fonts.reg, 5.2, mm(30), 2);
    lines.forEach((l, j) => {
      text(page, l, colX + 3.4, sy - j * 2.6, 5.2, fonts.reg, INK);
    });
    sy -= lines.length * 2.6 + 2.6;
  }

  // Mention obligatoire (spec) + site.
  const mention = "Cashback utilisable en magasin · non retirable en espèces";
  const mw = fonts.reg.widthOfTextAtSize(mention, 4.6) / M;
  text(page, mention, g.trimW / 2 - mw / 2, 4.6, 4.6, fonts.reg, MUTED);
  const siteW = fonts.bold.widthOfTextAtSize("coligo.app", 5) / M;
  text(
    page,
    "coligo.app",
    g.trimW / 2 - siteW / 2,
    1.6,
    5,
    fonts.bold,
    pdfColor(tpl.versoAccent)
  );

  drawCropMarks(page);
  drawSlugInfo(page, `Coligo · carte ${index + 1}/${total} · verso`, fonts);
}

/* --------------------------------- BUILDER -------------------------------- */

export async function buildLoyaltyCardsPdf(
  input: CardPdfInput
): Promise<Uint8Array> {
  const displayName =
    input.printMerchantName !== false &&
    (input.merchantName ?? "").trim() !== ""
      ? (input.merchantName ?? "").trim()
      : null;

  const doc = await PDFDocument.create();
  doc.setTitle(
    displayName
      ? `Cartes fidélité Coligo — ${safe(displayName)}`
      : "Cartes fidélité Coligo — génériques"
  );
  doc.setProducer("Coligo");

  const fonts = {
    reg: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    mono: await doc.embedFont(StandardFonts.CourierBold),
  };
  let arLogo: PDFImage | null = null;
  if (input.arabicLogoPng && input.arabicLogoPng.length > 0) {
    try {
      arLogo = await doc.embedPng(input.arabicLogoPng);
    } catch {
      arLogo = null; // pas bloquant : la carte sort sans la pastille arabe
    }
  }

  const ctx: Ctx = {
    fonts,
    arLogo,
    tpl: getCardTemplate(input.templateKey),
    displayName,
  };

  const base = input.baseUrl.replace(/\/+$/, "");
  const pageW = mm(CARD_PDF_GEOM.pageW);
  const pageH = mm(CARD_PDF_GEOM.pageH);

  for (let i = 0; i < input.cards.length; i++) {
    const code = input.cards[i].code;
    // Même encodeur QR que les tickets scannés chaque jour en caisse ;
    // marge 0 : la zone de silence est notre padding blanc de 2 mm.
    const matrix = await qrMatrix(`${base}/c/${code}`, { margin: 0 });

    const recto = doc.addPage([pageW, pageH]);
    drawRecto(recto, ctx, code, matrix);
    drawSlugInfo(
      recto,
      `Coligo · ${safe(displayName ?? "générique")} · carte ${i + 1}/${input.cards.length} · recto`,
      fonts
    );

    const verso = doc.addPage([pageW, pageH]);
    drawVerso(verso, ctx, i, input.cards.length);
  }

  return doc.save();
}
