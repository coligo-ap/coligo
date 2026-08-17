import {
  LineCapStyle,
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
import { getCardTemplate, groupCardCode } from "@/lib/loyalty/card-templates";

// =============================================================================
// PDF D'IMPRESSION des cartes de fidélité — design de RÉFÉRENCE du propriétaire
// (maquettes 11482/11483, reproduction exigée à l'identique) : dégradé diagonal
// violet → rose à facettes (PNG public/brand/loyalty-card-bg-<modèle>.png, la
// MÊME image que l'aperçu de la console admin — source visuelle unique), logo
// Coligo FR+AR, pilule « CARTE FIDÉLITÉ · بطاقة الوفاء », QR à modules VIOLETS
// sur panneau blanc, « CHEZ + commerçant », numéro en clair. Verso : QR de
// téléchargement de l'appli (/app), badges stores, services exclusifs.
//
// pdf-lib serveur, jamais window.print. UNE CARTE PAR PAGE (recto puis verso,
// pour l'impression recto/verso du sous-traitant), format CR80 85,6 × 54 mm,
// FONDS PERDUS 3 mm + TRAITS DE COUPE dans une zone technique de 6 mm.
// Le QR du recto encode l'URL publique /c/<code> (même encodeur zxing que les
// tickets scannés en prod) ; le numéro est imprimé en clair, groupé par 4
// (saisie manuelle de secours). Le PDF n'est JAMAIS stocké : régénéré à la
// volée depuis la base (patron des contrats).
//
// DESIGN PERSONNALISÉ (mig 0461) : si le lot porte un visuel fourni par
// l'équipe Coligo (art recto/verso, fond perdu compris), le recto = l'image +
// UNIQUEMENT le panneau QR et le numéro par-dessus ; le verso = l'image telle
// quelle.
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

/** Assets visuels embarqués (public/brand/) — tous OPTIONNELS : la carte sort
 *  toujours (repli aplat/vectoriel), jamais bloquant. */
export type CardPdfAssets = {
  /** Dégradé de fond du modèle (loyalty-card-bg-<key>.png, fonds perdus compris). */
  backgroundPng?: Uint8Array | null;
  /** Logotype Coligo FR+AR (logo-full-white.png / logo-full.png pour « clair »). */
  logoPng?: Uint8Array | null;
  /** « بطاقة الوفاء » (loyalty-ar-wafa-white/violet.png) pour la pilule du recto. */
  arWafaPng?: Uint8Array | null;
};

export type CardPdfInput = {
  /** Vide/absent = carte GÉNÉRIQUE Coligo (valable chez tous). */
  merchantName?: string | null;
  /** false = ne pas imprimer « CHEZ X » même si un commerçant est rattaché. */
  printMerchantName?: boolean;
  templateKey: string;
  cards: { code: string }[];
  /** Origine publique STABLE (les cartes vivent des années) — ex. https://coligo.app */
  baseUrl: string;
  assets?: CardPdfAssets;
  /** Visuel PERSONNALISÉ du lot (PNG ou JPEG, fond perdu compris) : recto =
   *  image + QR + numéro seulement ; verso = image telle quelle. */
  artRecto?: Uint8Array | null;
  artVerso?: Uint8Array | null;
};

type Ctx = {
  fonts: { reg: PDFFont; bold: PDFFont; mono: PDFFont };
  bg: PDFImage | null;
  logo: PDFImage | null;
  arWafa: PDFImage | null;
  artRecto: PDFImage | null;
  artVerso: PDFImage | null;
  tpl: ReturnType<typeof getCardTemplate>;
  /** Nom imprimé sur la carte — null = générique (« tous tes commerçants »). */
  displayName: string | null;
};

const WHITE = pdfColor(LOYALTY_CARD.paper);
const QR_INK = pdfColor(LOYALTY_CARD.qrInk);
const BADGE_BLACK = pdfColor(LOYALTY_CARD.badgeInk);

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
      color: PDF_INK.INK,
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
    color: PDF_INK.MUTED,
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
  color: ReturnType<typeof rgb>,
  opacity = 1
) {
  const o = CARD_PDF_GEOM.origin;
  page.drawRectangle({
    x: mm(o + x),
    y: mm(o + y),
    width: mm(w),
    height: mm(h),
    color,
    opacity,
  });
}

function text(
  page: PDFPage,
  s: string,
  x: number,
  y: number,
  size: number,
  font: PDFFont,
  color: ReturnType<typeof rgb>,
  opacity = 1
) {
  const o = CARD_PDF_GEOM.origin;
  page.drawText(s, { x: mm(o + x), y: mm(o + y), size, font, color, opacity });
}

/** Largeur d'un texte en mm. */
function wOf(s: string, font: PDFFont, size: number): number {
  return font.widthOfTextAtSize(s, size) / M;
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

/** Image posée en coordonnées « format fini », hauteur imposée (ratio gardé).
 *  Renvoie la largeur dessinée (mm). */
function image(
  page: PDFPage,
  img: PDFImage,
  x: number,
  y: number,
  h: number
): number {
  const w = (img.width / img.height) * h;
  const o = CARD_PDF_GEOM.origin;
  page.drawImage(img, {
    x: mm(o + x),
    y: mm(o + y),
    width: mm(w),
    height: mm(h),
  });
  return w;
}

/** Fond de carte : image du dégradé (fonds perdus compris) — repli aplat g2. */
function drawBackground(page: PDFPage, ctx: Ctx, art: PDFImage | null) {
  const g = CARD_PDF_GEOM;
  const o = g.origin;
  const img = art ?? ctx.bg;
  if (img) {
    page.drawImage(img, {
      x: mm(o - g.bleed),
      y: mm(o - g.bleed),
      width: mm(g.trimW + 2 * g.bleed),
      height: mm(g.trimH + 2 * g.bleed),
    });
  } else {
    rect(
      page,
      -g.bleed,
      -g.bleed,
      g.trimW + 2 * g.bleed,
      g.trimH + 2 * g.bleed,
      pdfColor(ctx.tpl.g2)
    );
  }
}

/** Pilule translucide (langage des maquettes) : texte FR + éventuel PNG arabe,
 *  ancrée par son bord DROIT. Renvoie la largeur totale (mm). */
function drawPill(
  page: PDFPage,
  ctx: Ctx,
  rightX: number,
  y: number,
  h: number,
  label: string,
  size: number,
  withArabic: boolean
) {
  const { tpl, fonts } = ctx;
  const padX = 2.6;
  const gap = 1.5;
  const arH = h * 0.48;
  const arW =
    withArabic && ctx.arWafa ? (ctx.arWafa.width / ctx.arWafa.height) * arH : 0;
  const dot = withArabic && ctx.arWafa ? wOf("·", fonts.bold, size) : 0;
  const labelW = wOf(label, fonts.bold, size);
  const total = padX + labelW + (arW > 0 ? gap + dot + gap + arW : 0) + padX;
  const x = rightX - total;
  // Fond : blanc translucide sur modèles sombres, encre violette 8 % en clair.
  roundedRect(
    page,
    x,
    y,
    total,
    h,
    h / 2,
    tpl.light ? QR_INK : WHITE,
    tpl.light ? 0.08 : 0.16
  );
  const textColor = pdfColor(tpl.text);
  const textY = y + h / 2 - size / (2 * M) + 0.35;
  text(page, label, x + padX, textY, size, fonts.bold, textColor);
  if (arW > 0 && ctx.arWafa) {
    const dotX = x + padX + labelW + gap;
    text(page, "·", dotX, textY, size, fonts.bold, textColor, 0.75);
    image(page, ctx.arWafa, dotX + dot + gap, y + (h - arH) / 2, arH);
  }
  return total;
}

/** QR sur panneau blanc arrondi (zone de silence garantie par le padding),
 *  modules VIOLETS (référence imprimée). Runs horizontaux fusionnés. */
function drawQr(
  page: PDFPage,
  ctx: Ctx,
  matrix: boolean[][],
  panelX: number,
  panelY: number,
  panelSize: number,
  padding: number
) {
  roundedRect(page, panelX, panelY, panelSize, panelSize, 2.4, WHITE);
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
          color: QR_INK,
        });
        run = -1;
      }
    }
  }
}

/** Icône lucide (viewBox 24) tracée au TRAIT, bouts ronds. */
function drawIcon(
  page: PDFPage,
  paths: string[],
  dots: { cx: number; cy: number; r: number }[],
  x: number,
  y: number,
  sizeMm: number,
  color: ReturnType<typeof rgb>
) {
  const o = CARD_PDF_GEOM.origin;
  const scale = mm(sizeMm) / 24;
  const strokeW = mm(sizeMm) / 12;
  for (const d of paths) {
    page.drawSvgPath(d, {
      x: mm(o + x),
      y: mm(o + y + sizeMm),
      scale,
      borderColor: color,
      borderWidth: strokeW,
      borderLineCap: LineCapStyle.Round,
    });
  }
  for (const c of dots) {
    page.drawEllipse({
      x: mm(o + x) + c.cx * scale,
      y: mm(o + y + sizeMm) - c.cy * scale,
      xScale: c.r * scale,
      yScale: c.r * scale,
      borderColor: color,
      borderWidth: strokeW,
    });
  }
}

// Tracés lucide (shopping-cart, truck) — mêmes icônes que l'app.
const ICON_CART = {
  paths: [
    "M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12",
  ],
  dots: [
    { cx: 8, cy: 21, r: 1 },
    { cx: 19, cy: 21, r: 1 },
  ],
};
const ICON_TRUCK = {
  paths: [
    "M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2",
    "M15 18H9",
    "M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14",
  ],
  dots: [
    { cx: 17, cy: 18, r: 2 },
    { cx: 7, cy: 18, r: 2 },
  ],
};

/* ----------------------------------- RECTO -------------------------------- */

function drawRecto(page: PDFPage, ctx: Ctx, code: string, matrix: boolean[][]) {
  const g = CARD_PDF_GEOM;
  const { tpl, fonts } = ctx;
  const textColor = pdfColor(tpl.text);
  const subColor = pdfColor(tpl.subtext);

  drawBackground(page, ctx, ctx.artRecto);

  // VISUEL PERSONNALISÉ : on ne pose QUE le QR et le numéro (mig 0461).
  const artOnly = !!ctx.artRecto;

  if (!artOnly) {
    // Marque : logotype Coligo FR+AR en haut à gauche (comme la maquette).
    if (ctx.logo) {
      image(page, ctx.logo, 5.5, 39.6, 8.6);
    } else {
      text(page, "Coligo", 5.5, 42, 14, fonts.bold, textColor);
    }

    // Pilule « CARTE FIDÉLITÉ · بطاقة الوفاء » ancrée en haut à droite.
    drawPill(page, ctx, g.trimW - 4.5, 42.2, 5.8, "CARTE FIDÉLITÉ", 4.6, true);

    // Colonne droite : « CHEZ » + nom du commerçant (maquette 11482).
    if (ctx.displayName) {
      const name = safe(ctx.displayName);
      text(page, "CHEZ", 36.5, 29.6, 6, fonts.reg, subColor);
      let size = 11.5;
      let lines = wrap(name, fonts.bold, size, mm(g.trimW - 36.5 - 4.5), 2);
      while (
        size > 7 &&
        (lines.length > 2 ||
          lines.some((l) => wOf(l, fonts.bold, size) > g.trimW - 41))
      ) {
        size -= 0.5;
        lines = wrap(name, fonts.bold, size, mm(g.trimW - 36.5 - 4.5), 2);
      }
      lines.forEach((l, i) => {
        text(
          page,
          l,
          36.5,
          24.2 - i * (size / M + 1.2),
          size,
          fonts.bold,
          textColor
        );
      });
    } else {
      // Carte GÉNÉRIQUE : valable chez tous les commerçants Coligo.
      const lines = wrap(
        "Valable chez tous tes commerçants.",
        fonts.bold,
        8,
        mm(g.trimW - 36.5 - 4.5),
        3
      );
      lines.forEach((l, i) => {
        text(page, l, 36.5, 26.5 - i * 4.2, 8, fonts.bold, textColor);
      });
    }
  }

  // QR à gauche sur panneau blanc arrondi, modules violets (référence).
  drawQr(page, ctx, matrix, 5.5, 12.5, 25, 2.1);

  // Numéro en clair, groupé par 4 (saisie manuelle de secours) — bas gauche.
  const grouped = groupCardCode(code);
  const codeSize = fitSize(grouped, fonts.mono, 8, mm(44), 5);
  text(
    page,
    grouped,
    5.5,
    5,
    codeSize,
    fonts.mono,
    artOnly ? WHITE : pdfColor(tpl.text)
  );

  drawCropMarks(page);
}

/* ----------------------------------- VERSO -------------------------------- */

function drawVerso(
  page: PDFPage,
  ctx: Ctx,
  code: string,
  appMatrix: boolean[][]
) {
  const g = CARD_PDF_GEOM;
  const { tpl, fonts } = ctx;
  const textColor = pdfColor(tpl.text);
  const subColor = pdfColor(tpl.subtext);

  drawBackground(page, ctx, ctx.artVerso);
  if (ctx.artVerso) {
    // Visuel personnalisé : imprimé TEL QUEL (aucune surimpression).
    drawCropMarks(page);
    return;
  }

  // Logotype centré en tête (maquette 11483).
  if (ctx.logo) {
    const w = (ctx.logo.width / ctx.logo.height) * 6.4;
    image(page, ctx.logo, (g.trimW - w) / 2, 45.2, 6.4);
  } else {
    const w = wOf("Coligo", fonts.bold, 11);
    text(page, "Coligo", (g.trimW - w) / 2, 47, 11, fonts.bold, textColor);
  }

  // ── Colonne gauche : télécharger l'appli ──────────────────────────────────
  const pillY = 36.4;
  const leftW = 37;
  {
    const label = "TÉLÉCHARGEZ NOTRE APPLI";
    const size = fitSize(label, fonts.bold, 4.6, mm(leftW - 5), 3.6);
    const w = wOf(label, fonts.bold, size) + 5.2;
    roundedRect(
      page,
      5 + (leftW - w) / 2,
      pillY,
      w,
      5.2,
      2.6,
      tpl.light ? QR_INK : WHITE,
      tpl.light ? 0.08 : 0.16
    );
    text(
      page,
      label,
      5 + (leftW - w) / 2 + 2.6,
      pillY + 2.6 - size / (2 * M) + 0.35,
      size,
      fonts.bold,
      textColor
    );
  }
  drawQr(page, ctx, appMatrix, 5 + (leftW - 19.6) / 2, 14.6, 19.6, 1.7);

  // Badges stores (flat, texte seul — pas de logos tiers embarqués).
  const badgeY = 7.4;
  const badgeH = 5.6;
  const badgeW = 17.8;
  const badges: [string, string][] = [
    ["Télécharge sur l'", "App Store"],
    ["Disponible sur", "Google Play"],
  ];
  badges.forEach(([cap, store], i) => {
    const bx = 5 + i * (badgeW + 1.4);
    roundedRect(page, bx, badgeY, badgeW, badgeH, 1.3, BADGE_BLACK);
    const capW = wOf(cap, fonts.reg, 2.5);
    text(
      page,
      cap,
      bx + (badgeW - capW) / 2,
      badgeY + 3.5,
      2.5,
      fonts.reg,
      WHITE,
      0.85
    );
    const storeW = wOf(store, fonts.bold, 3.5);
    text(
      page,
      store,
      bx + (badgeW - storeW) / 2,
      badgeY + 1.1,
      3.5,
      fonts.bold,
      WHITE
    );
  });

  // ── Colonne droite : services exclusifs ───────────────────────────────────
  const colX = 45.5;
  const colW = g.trimW - colX - 4.5;
  {
    const label = "SERVICES EXCLUSIFS";
    const size = fitSize(label, fonts.bold, 4.6, mm(colW - 5), 3.6);
    const w = wOf(label, fonts.bold, size) + 5.2;
    roundedRect(
      page,
      colX + (colW - w) / 2,
      pillY,
      w,
      5.2,
      2.6,
      tpl.light ? QR_INK : WHITE,
      tpl.light ? 0.08 : 0.16
    );
    text(
      page,
      label,
      colX + (colW - w) / 2 + 2.6,
      pillY + 2.6 - size / (2 * M) + 0.35,
      size,
      fonts.bold,
      textColor
    );
  }

  const iconColor = pdfColor(tpl.text);
  const textX = colX + 8.6;
  const textW = g.trimW - textX - 4.5;

  // Service 1 : retrait gratuit à l'avance (chez X / chez tes commerçants).
  drawIcon(page, ICON_CART.paths, ICON_CART.dots, colX, 26.2, 6, iconColor);
  {
    const title = ctx.displayName
      ? [
          "RETRAIT GRATUIT",
          "À L'AVANCE",
          `CHEZ ${safe(ctx.displayName).toUpperCase()}`,
        ]
      : ["RETRAIT GRATUIT", "À L'AVANCE"];
    let y = 31.2;
    for (const line of title) {
      const size = fitSize(line, fonts.bold, 4.8, mm(textW), 3.4);
      text(page, line, textX, y, size, fonts.bold, textColor);
      y -= 2.5;
    }
    const desc = wrap(
      "Commande à l'avance et récupère sans faire la file.",
      fonts.reg,
      3.6,
      mm(textW),
      2
    );
    for (const line of desc) {
      text(page, line, textX, y, 3.6, fonts.reg, subColor);
      y -= 2.1;
    }
  }

  // Service 2 : livraison à domicile.
  drawIcon(page, ICON_TRUCK.paths, ICON_TRUCK.dots, colX, 11.4, 6, iconColor);
  {
    let y = 16.2;
    for (const line of ["LIVRAISON", "À DOMICILE"]) {
      text(page, line, textX, y, 4.8, fonts.bold, textColor);
      y -= 2.5;
    }
    const desc = wrap(
      "Fais-toi livrer chez toi en toute simplicité.",
      fonts.reg,
      3.6,
      mm(textW),
      2
    );
    for (const line of desc) {
      text(page, line, textX, y, 3.6, fonts.reg, subColor);
      y -= 2.1;
    }
  }

  // Pied : numéro (rappel) à gauche, service client à droite.
  const grouped = groupCardCode(code);
  text(page, grouped, 5, 2.6, 6, fonts.mono, textColor, 0.9);
  const support = "SERVICE CLIENT : coligo.app";
  const sw = wOf(support, fonts.bold, 4);
  text(page, support, g.trimW - 4.5 - sw, 2.8, 4, fonts.bold, textColor);

  drawCropMarks(page);
}

/* --------------------------------- BUILDER -------------------------------- */

/** Détection du format d'un visuel personnalisé (PNG sinon JPEG). */
async function embedArt(
  doc: PDFDocument,
  bytes: Uint8Array | null | undefined
): Promise<PDFImage | null> {
  if (!bytes || bytes.length === 0) return null;
  try {
    const isPng =
      bytes.length > 8 &&
      bytes[0] === 0x89 &&
      bytes[1] === 0x50 &&
      bytes[2] === 0x4e &&
      bytes[3] === 0x47;
    return isPng ? await doc.embedPng(bytes) : await doc.embedJpg(bytes);
  } catch {
    return null; // visuel illisible : la carte sort au design standard
  }
}

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

  const ctx: Ctx = {
    fonts,
    bg: await embedArt(doc, input.assets?.backgroundPng),
    logo: await embedArt(doc, input.assets?.logoPng),
    arWafa: await embedArt(doc, input.assets?.arWafaPng),
    artRecto: await embedArt(doc, input.artRecto),
    artVerso: await embedArt(doc, input.artVerso),
    tpl: getCardTemplate(input.templateKey),
    displayName,
  };

  const base = input.baseUrl.replace(/\/+$/, "");
  const pageW = mm(CARD_PDF_GEOM.pageW);
  const pageH = mm(CARD_PDF_GEOM.pageH);

  // QR du verso : téléchargement de l'appli (landing client /app) — identique
  // sur toutes les cartes, calculé une seule fois.
  const appMatrix = await qrMatrix(`${base}/app`, { margin: 0 });

  for (let i = 0; i < input.cards.length; i++) {
    const code = input.cards[i].code;
    // Même encodeur QR que les tickets scannés chaque jour en caisse ;
    // marge 0 : la zone de silence est notre padding blanc.
    const matrix = await qrMatrix(`${base}/c/${code}`, { margin: 0 });

    const recto = doc.addPage([pageW, pageH]);
    drawRecto(recto, ctx, code, matrix);
    drawSlugInfo(
      recto,
      `Coligo · ${safe(displayName ?? "générique")} · carte ${i + 1}/${input.cards.length} · recto`,
      fonts
    );

    const verso = doc.addPage([pageW, pageH]);
    drawVerso(verso, ctx, code, appMatrix);
    drawSlugInfo(
      verso,
      `Coligo · carte ${i + 1}/${input.cards.length} · verso`,
      fonts
    );
  }

  return doc.save();
}
