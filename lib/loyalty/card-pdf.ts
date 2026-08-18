import {
  PDFDocument,
  StandardFonts,
  degrees,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
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
  /** « بطاقة الوفاء » — PNG pré-rendu en police ARABE dédiée (Segoe UI), DROIT :
   *  pdf-lib ne shape pas l'arabe, et l'italique n'existe pas dans cette
   *  écriture (l'incliner « casse » la calligraphie). */
  arWafaPng?: Uint8Array | null;
  /** Carlito-BoldItalic.ttf (public/brand/fonts) — l'équivalent LIBRE de
   *  Calibri (métriques identiques) pour le grand titre italique du recto.
   *  Absent = repli Helvetica-BoldOblique, jamais bloquant. */
  titleFontBytes?: Uint8Array | null;
  /** VRAIS logos des stores (fournis par le propriétaire, public/brand/
   *  store-appstore.png / store-play.png) pour les badges du verso. */
  storeApplePng?: Uint8Array | null;
  storePlayPng?: Uint8Array | null;
  /** Lignes DARIJA du verso (PNG Segoe UI pré-rendus, public/brand/flyer/
   *  darija-line-*.png) — dans l'ordre : promos, chaîne, livraison, dahabia. */
  darijaLinesPngs?: (Uint8Array | null)[];
  /** Décor PRODUITS du recto (public/brand/loyalty-decor/, fond transparent) :
   *  choisi par la ROUTE selon la catégorie du commerçant (supérette = marques
   *  algériennes détourées, food = médaillons ronds). Vide = pas de décor. */
  decorPngs?: (Uint8Array | null)[];
};

export type CardPdfInput = {
  /** Vide/absent = carte GÉNÉRIQUE Coligo (valable chez tous). */
  merchantName?: string | null;
  /** false = ne pas imprimer « CHEZ X » même si un commerçant est rattaché. */
  printMerchantName?: boolean;
  /** false = pas de bloc titre « CARTE DE FIDÉLITÉ / بطاقة الوفاء » (0462). */
  printTitle?: boolean;
  /** true = mention basse « Carte valable chez tous les commerçants » (0462). */
  printValidAll?: boolean;
  /** Logo du commerçant (PNG/JPEG DÉJÀ normalisé côté route — jamais de WebP),
   *  posé sur un socle blanc du recto : chaque commerçant a un logo de format
   *  différent, l'image est CONTENUE dans le socle (ratio gardé). */
  merchantLogoPng?: Uint8Array | null;
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
  fonts: {
    reg: PDFFont;
    bold: PDFFont;
    mono: PDFFont;
    /** Titre du recto : Carlito-BoldItalic (= Calibri italique) si fourni,
     *  sinon Helvetica-BoldOblique. */
    title: PDFFont;
    italic: PDFFont;
  };
  bg: PDFImage | null;
  logo: PDFImage | null;
  arWafa: PDFImage | null;
  merchantLogo: PDFImage | null;
  storeApple: PDFImage | null;
  storePlay: PDFImage | null;
  darijaLines: (PDFImage | null)[];
  decor: PDFImage[];
  artRecto: PDFImage | null;
  artVerso: PDFImage | null;
  tpl: ReturnType<typeof getCardTemplate>;
  /** Nom imprimé sur la carte — null = générique (« tous tes commerçants »). */
  displayName: string | null;
  printTitle: boolean;
  printValidAll: boolean;
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

/** Logo du COMMERÇANT sur socle blanc arrondi. Chaque commerçant a un logo de
 *  format différent : l'image est CONTENUE dans le socle (ratio gardé,
 *  centrée) — un logo très large ou très haut reste net, jamais déformé. */
function drawMerchantLogoPlate(
  page: PDFPage,
  ctx: Ctx,
  x: number,
  y: number,
  size: number
) {
  roundedRect(page, x, y, size, size, 2.6, WHITE);
  const img = ctx.merchantLogo;
  if (!img) return;
  const pad = size * 0.12;
  const box = size - 2 * pad;
  const ratio = img.width / img.height;
  const w = ratio >= 1 ? box : box * ratio;
  const h = ratio >= 1 ? box / ratio : box;
  const o = CARD_PDF_GEOM.origin;
  page.drawImage(img, {
    x: mm(o + x + pad + (box - w) / 2),
    y: mm(o + y + pad + (box - h) / 2),
    width: mm(w),
    height: mm(h),
  });
}

/** Tag « COMMERÇANT » RECTANGULAIRE, INTÉGRÉ au panneau QR : un bandeau plein
 *  à angles droits soudé au bord HAUT du panneau (coins hauts du panneau
 *  équarris pour un raccord net) — un seul bloc visuel avec le QR. Couleurs
 *  ADAPTÉES au modèle, texte blanc. */
function drawQrTag(
  page: PDFPage,
  ctx: Ctx,
  panelX: number,
  panelTopY: number,
  panelSize: number
) {
  const { tpl, fonts } = ctx;
  const label = "COMMERÇANT";
  const w = panelSize;
  const h = 4.8;
  // Équarrir les coins HAUTS du panneau (arrondis 2.4) → raccord sans encoche.
  rect(page, panelX, panelTopY - 2.4, w, 2.4, WHITE);
  rect(page, panelX, panelTopY, w, h, tpl.light ? QR_INK : pdfColor(tpl.g2));
  const size = fitSize(label, fonts.bold, 4.6, mm(w - 5), 3.2);
  const tw = wOf(label, fonts.bold, size);
  text(
    page,
    label,
    panelX + (w - tw) / 2,
    panelTopY + h / 2 - size / (2 * M) + 0.32,
    size,
    fonts.bold,
    WHITE
  );
}

/** Décor PRODUITS (option par catégorie de commerce) : accents photo posés sur
 *  les BORDS de la carte, débordant dans les fonds perdus (rognés à la coupe),
 *  légèrement inclinés — le langage des grandes enseignes de fidélité. Les
 *  emplacements évitent le contenu (QR, titres, numéro). */
function drawDecor(page: PDFPage, ctx: Ctx) {
  if (ctx.decor.length === 0) return;
  const g = CARD_PDF_GEOM;
  const o = g.origin;
  const slots: { x: number; y: number; h: number; rot: number }[] = [
    // Coin haut-droit, à cheval sur la coupe.
    { x: g.trimW - 8.5, y: g.trimH - 10, h: 13, rot: -14 },
    // Bord droit, sous le milieu.
    { x: g.trimW - 6, y: 15, h: 11, rot: 10 },
    // Coin bas-gauche.
    { x: -3.2, y: -3.6, h: 10.5, rot: 12 },
  ];
  for (let i = 0; i < Math.min(ctx.decor.length, slots.length); i++) {
    const img = ctx.decor[i];
    const s = slots[i];
    const w = (img.width / img.height) * s.h;
    page.drawImage(img, {
      x: mm(o + s.x),
      y: mm(o + s.y),
      width: mm(w),
      height: mm(s.h),
      rotate: degrees(s.rot),
    });
  }
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

/** Badge store « officiel » : rectangle noir arrondi, VRAI logo du store
 *  (PNG fourni par le propriétaire) + accroche petite / nom du store en
 *  GRAS — le langage visuel connu de tous, compréhension immédiate. */
function drawStoreBadge(
  page: PDFPage,
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  kind: "apple" | "play"
) {
  const { fonts } = ctx;
  roundedRect(page, x, y, w, h, 1.4, BADGE_BLACK);
  const img = kind === "apple" ? ctx.storeApple : ctx.storePlay;
  const logoH = h * 0.58;
  const logoY = y + (h - logoH) / 2;
  let logoW = logoH;
  if (img) {
    logoW = image(page, img, x + 2, logoY, logoH);
  }
  const textX = x + 2 + logoW + 1.3;
  // Libellés BIEN LISIBLES : blanc plein, accroche agrandie, nom du store en
  // gras au maximum de la place disponible (retour proprio : « on ne les
  // voyait pas du tout »).
  const cap = kind === "apple" ? "Télécharge sur l'" : "Disponible sur";
  const store = kind === "apple" ? "App Store" : "Google Play";
  const capSize = fitSize(cap, fonts.bold, 2.7, mm(w - (textX - x) - 1.2), 2);
  text(page, cap, textX, y + h - 3, capSize, fonts.bold, WHITE);
  const storeSize = fitSize(
    store,
    fonts.bold,
    4.4,
    mm(w - (textX - x) - 1.2),
    3
  );
  text(page, store, textX, y + 1.1, storeSize, fonts.bold, WHITE);
}

/** Icônes réseaux sociaux vectorielles : Facebook (disque plein + « f »),
 *  Instagram (carré arrondi + objectif + point) — suivies de « Coligo App »
 *  en gras. Renvoie la largeur totale (mm). */
function drawSocialRow(
  page: PDFPage,
  ctx: Ctx,
  x: number,
  y: number,
  s: number,
  kind: "facebook" | "instagram",
  label: string
): number {
  const { tpl, fonts } = ctx;
  const o = CARD_PDF_GEOM.origin;
  const color = pdfColor(tpl.text);
  if (kind === "facebook") {
    page.drawEllipse({
      x: mm(o + x + s / 2),
      y: mm(o + y + s / 2),
      xScale: mm(s / 2),
      yScale: mm(s / 2),
      color,
    });
    const f = "f";
    const fSize = s * M * 0.72;
    const fw = wOf(f, fonts.bold, fSize);
    text(
      page,
      f,
      x + (s - fw) / 2 + 0.1,
      y + s * 0.14,
      fSize,
      fonts.bold,
      tpl.light ? WHITE : pdfColor(tpl.g2)
    );
  } else {
    const stroke = mm(s) / 11;
    page.drawSvgPath(
      `M ${s * 0.26} 0 H ${s * 0.74} Q ${s} 0 ${s} ${s * 0.26} V ${s * 0.74} Q ${s} ${s} ${s * 0.74} ${s} H ${s * 0.26} Q 0 ${s} 0 ${s * 0.74} V ${s * 0.26} Q 0 0 ${s * 0.26} 0 Z`,
      {
        x: mm(o + x),
        y: mm(o + y + s),
        scale: M,
        borderColor: color,
        borderWidth: stroke,
      }
    );
    page.drawEllipse({
      x: mm(o + x + s / 2),
      y: mm(o + y + s / 2),
      xScale: mm(s * 0.22),
      yScale: mm(s * 0.22),
      borderColor: color,
      borderWidth: stroke,
    });
    page.drawEllipse({
      x: mm(o + x + s * 0.76),
      y: mm(o + y + s * 0.76),
      xScale: mm(s * 0.055),
      yScale: mm(s * 0.055),
      color,
    });
  }
  const size = s * M * 0.62;
  text(page, label, x + s + 1.2, y + s * 0.22, size, fonts.bold, color);
  return s + 1.2 + wOf(label, fonts.bold, size);
}

/* ----------------------------------- RECTO -------------------------------- */

/** Titre du recto : « CARTE DE FIDÉLITÉ » en Carlito (Calibri) ITALIQUE,
 *  « بطاقة الوفاء » DROIT dessous (l'arabe ne s'italicise pas). CENTRÉ sur
 *  centerX — le titre vit EN HAUT AU MILIEU de la carte. */
function drawTitleBlock(
  page: PDFPage,
  ctx: Ctx,
  centerX: number,
  baselineY: number,
  maxW: number,
  frSize: number,
  arH: number
) {
  const { fonts, tpl } = ctx;
  const textColor = pdfColor(tpl.text);
  const title = "CARTE DE FIDÉLITÉ";
  const size = fitSize(title, fonts.title, frSize, mm(maxW), 7);
  const w = wOf(title, fonts.title, size);
  text(page, title, centerX - w / 2, baselineY, size, fonts.title, textColor);
  if (ctx.arWafa) {
    const arW = (ctx.arWafa.width / ctx.arWafa.height) * arH;
    image(page, ctx.arWafa, centerX - arW / 2, baselineY - arH - 1.4, arH);
  }
}

function drawRecto(page: PDFPage, ctx: Ctx, code: string, matrix: boolean[][]) {
  const g = CARD_PDF_GEOM;
  const { tpl, fonts } = ctx;
  const textColor = pdfColor(tpl.text);

  drawBackground(page, ctx, ctx.artRecto);

  // VISUEL PERSONNALISÉ : on ne pose QUE le QR et le numéro (mig 0461).
  if (ctx.artRecto) {
    drawQr(page, ctx, matrix, 5.5, 12.5, 25, 2.1);
    const grouped = groupCardCode(code);
    text(
      page,
      grouped,
      5.5,
      5,
      fitSize(grouped, fonts.mono, 8, mm(44), 5),
      fonts.mono,
      WHITE
    );
    drawCropMarks(page);
    return;
  }

  const hasMerchant = !!ctx.displayName || !!ctx.merchantLogo;

  if (hasMerchant) {
    // ── RECTO COMMERÇANT : titre EN HAUT AU MILIEU, logo Coligo COLLÉ au
    // coin haut-gauche, puis carte SCINDÉE en deux moitiés STRICTEMENT
    // égales — à gauche le QR (tag « COMMERÇANT » pleine largeur) + numéro,
    // à droite le logo du commerçant + son nom, panneaux au MÊME gabarit.
    if (ctx.logo) {
      image(page, ctx.logo, 3.5, 45.2, 5.8);
    } else {
      text(page, "Coligo", 3.5, 46.4, 9, fonts.bold, textColor);
    }
    if (ctx.printTitle) {
      drawTitleBlock(page, ctx, g.trimW / 2, 48, 46, 10.5, 3.2);
    }

    const midX = g.trimW / 2;
    const halfW = (g.trimW - 9) / 2; // marges 4.5 de part et d'autre
    const panel = 24;
    const panelY = 12.8;
    // Séparateur central discret — la division en deux se LIT.
    rect(
      page,
      midX - 0.125,
      10.5,
      0.25,
      28.3,
      tpl.light ? QR_INK : WHITE,
      0.22
    );

    // Moitié GAUCHE : QR + tag + numéro centré sous le panneau.
    const qrX = 4.5 + (halfW - panel) / 2;
    drawQr(page, ctx, matrix, qrX, panelY, panel, 2);
    drawQrTag(page, ctx, qrX, panelY + panel, panel);
    const grouped = groupCardCode(code);
    const codeSize = fitSize(grouped, fonts.mono, 6.5, mm(halfW - 2), 4.5);
    const codeW = wOf(grouped, fonts.mono, codeSize);
    text(
      page,
      grouped,
      4.5 + (halfW - codeW) / 2,
      7.6,
      codeSize,
      fonts.mono,
      textColor
    );

    // Moitié DROITE : socle logo au MÊME gabarit que le QR + nom en GRAS.
    const plateX = midX + (halfW - panel) / 2;
    if (ctx.merchantLogo) {
      drawMerchantLogoPlate(page, ctx, plateX, panelY, panel);
    }
    if (ctx.displayName) {
      const name = safe(ctx.displayName);
      if (ctx.merchantLogo) {
        // Nom centré SOUS le socle — symétrique du numéro sous le QR.
        let size = 8;
        let lines = wrap(name, fonts.bold, size, mm(halfW - 2), 2);
        while (
          size > 4.5 &&
          (lines.length > 2 ||
            lines.some((l) => wOf(l, fonts.bold, size) > halfW - 2))
        ) {
          size -= 0.5;
          lines = wrap(name, fonts.bold, size, mm(halfW - 2), 2);
        }
        lines.forEach((l, i) => {
          const lw = wOf(l, fonts.bold, size);
          text(
            page,
            l,
            midX + (halfW - lw) / 2,
            7.6 - i * (size / M + 0.9),
            size,
            fonts.bold,
            textColor
          );
        });
      } else {
        // Pas de logo : le NOM devient le héros de la moitié droite.
        let size = 13.5;
        let lines = wrap(name, fonts.bold, size, mm(halfW - 3), 2);
        while (
          size > 7 &&
          (lines.length > 2 ||
            lines.some((l) => wOf(l, fonts.bold, size) > halfW - 3))
        ) {
          size -= 0.5;
          lines = wrap(name, fonts.bold, size, mm(halfW - 3), 2);
        }
        const blockH = lines.length * (size / M + 1.2);
        let y = panelY + panel / 2 + blockH / 2 - size / M;
        for (const l of lines) {
          const lw = wOf(l, fonts.bold, size);
          text(
            page,
            l,
            midX + (halfW - lw) / 2,
            y,
            size,
            fonts.bold,
            textColor
          );
          y -= size / M + 1.2;
        }
      }
    }

    if (ctx.printValidAll) {
      const mention = "Carte valable chez tous les commerçants";
      const size = fitSize(mention, fonts.italic, 3.8, mm(60), 3);
      const w = wOf(mention, fonts.italic, size);
      text(
        page,
        mention,
        (g.trimW - w) / 2,
        3.4,
        size,
        fonts.italic,
        textColor,
        0.9
      );
    }
  } else {
    // ── RECTO GÉNÉRIQUE : logo COLLÉ au coin haut-gauche, titre EN HAUT AU
    // MILIEU, QR à gauche, mention en grand dans la colonne droite. ──
    if (ctx.logo) {
      image(page, ctx.logo, 3.5, 44.6, 6.4);
    } else {
      text(page, "Coligo", 3.5, 46, 10, fonts.bold, textColor);
    }
    if (ctx.printTitle) {
      drawTitleBlock(page, ctx, g.trimW / 2, 47.6, 48, 12, 3.6);
    }
    drawQr(page, ctx, matrix, 5.5, 11.5, 25, 2.1);
    drawQrTag(page, ctx, 5.5, 36.5, 25);
    const grouped = groupCardCode(code);
    text(
      page,
      grouped,
      5.5,
      4.6,
      fitSize(grouped, fonts.mono, 8, mm(44), 5),
      fonts.mono,
      textColor
    );
    if (ctx.printValidAll) {
      // Colonne droite libérée par le titre : la mention y respire, en grand.
      const colX = 36.5;
      const colW = g.trimW - colX - 4.5;
      const mention = "Carte valable chez tous les commerçants";
      const size = 6;
      const lines = wrap(mention, fonts.italic, size, mm(colW), 3);
      lines.forEach((l, i) => {
        const lw = wOf(l, fonts.italic, size);
        text(
          page,
          l,
          colX + (colW - lw) / 2,
          26.5 - i * (size / M + 1),
          size,
          fonts.italic,
          textColor,
          0.95
        );
      });
    }
  }

  // Décor produits par catégorie de commerce (bords, fonds perdus).
  drawDecor(page, ctx);

  drawCropMarks(page);
}

/* ----------------------------------- VERSO -------------------------------- */

function drawVerso(
  page: PDFPage,
  ctx: Ctx,
  code: string,
  siteMatrix: boolean[][],
  siteHost: string
) {
  const g = CARD_PDF_GEOM;
  const { tpl, fonts } = ctx;
  const textColor = pdfColor(tpl.text);

  drawBackground(page, ctx, ctx.artVerso);
  if (ctx.artVerso) {
    // Visuel personnalisé : imprimé TEL QUEL (aucune surimpression).
    drawCropMarks(page);
    return;
  }

  // Logotype centré en tête.
  if (ctx.logo) {
    const w = (ctx.logo.width / ctx.logo.height) * 5.4;
    image(page, ctx.logo, (g.trimW - w) / 2, 46.6, 5.4);
  } else {
    const w = wOf("Coligo", fonts.bold, 10);
    text(page, "Coligo", (g.trimW - w) / 2, 47.6, 10, fonts.bold, textColor);
  }

  // ── LIGNES pleine largeur, GRANDES : FR gras + DARIJA dessous (retour
  // proprio : « lignes par lignes en grand pour bien communiquer, arabe
  // algérien street sous chaque titre »). ─────────────────────────────────
  const lines: { fr: string; ar: number }[] = [
    { fr: "PROMOS & RÉDUCTIONS", ar: 0 },
    { fr: "COMMANDEZ & RÉCUPÉREZ", ar: 1 },
    { fr: "LIVRAISON À DOMICILE", ar: 2 },
    { fr: "DAHABIA, CIB WELA CASH", ar: 3 },
  ];
  const zoneTop = 45.4;
  const rowH = 7.4;
  let y = zoneTop;
  for (const l of lines) {
    const size = fitSize(l.fr, fonts.bold, 6.2, mm(g.trimW - 12), 4.5);
    const w = wOf(l.fr, fonts.bold, size);
    text(page, l.fr, (g.trimW - w) / 2, y - 2.4, size, fonts.bold, textColor);
    const arImg = ctx.darijaLines[l.ar] ?? null;
    if (arImg) {
      const arH = 2.7;
      const arW = (arImg.width / arImg.height) * arH;
      image(page, arImg, (g.trimW - arW) / 2, y - 2.7 - arH - 0.7, arH);
    }
    y -= rowH;
  }

  // ── Pied : QR site + www EN GRAS, réseaux sociaux, badges stores. ───────
  const qrSize = 12.5;
  drawQr(page, ctx, siteMatrix, 4.5, 2.6, qrSize, 1.2);
  const colX = 4.5 + qrSize + 2.2;
  const www = `www.${siteHost}`;
  const wwwSize = fitSize(www, fonts.bold, 6, mm(30), 4.2);
  text(page, www, colX, 11.4, wwwSize, fonts.bold, textColor);
  drawSocialRow(page, ctx, colX, 6.6, 3, "facebook", "Coligo App");
  drawSocialRow(page, ctx, colX, 2.6, 3, "instagram", "Coligo App");

  // Badges stores empilés à droite — libellés grands et blancs.
  const badgeW = 26;
  const badgeH = 6.2;
  const bx = g.trimW - 4.5 - badgeW;
  drawStoreBadge(page, ctx, bx, 2.6 + badgeH + 0.9, badgeW, badgeH, "apple");
  drawStoreBadge(page, ctx, bx, 2.6, badgeW, badgeH, "play");

  // Numéro (rappel discret) dans la zone technique côté façonnier.
  void code;

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

  // Carlito-BoldItalic (= Calibri italique, libre) pour le grand titre —
  // embarqué en sous-ensemble via fontkit ; repli Helvetica-BoldOblique.
  doc.registerFontkit(fontkit);
  const titleBytes =
    input.printTitle !== false ? (input.assets?.titleFontBytes ?? null) : null;
  const fonts = {
    reg: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    mono: await doc.embedFont(StandardFonts.CourierBold),
    // PIÈGE : `subset: true` corrompt le cmap (titre rendu « D F D ») —
    // police embarquée ENTIÈRE (~800 Ko une fois par PDF, fichier d'imprimerie).
    title:
      titleBytes && titleBytes.length > 0
        ? await doc.embedFont(titleBytes)
        : await doc.embedFont(StandardFonts.HelveticaBoldOblique),
    italic: await doc.embedFont(StandardFonts.HelveticaOblique),
  };

  const ctx: Ctx = {
    fonts,
    bg: await embedArt(doc, input.assets?.backgroundPng),
    logo: await embedArt(doc, input.assets?.logoPng),
    arWafa: await embedArt(doc, input.assets?.arWafaPng),
    merchantLogo: await embedArt(doc, input.merchantLogoPng),
    storeApple: await embedArt(doc, input.assets?.storeApplePng),
    storePlay: await embedArt(doc, input.assets?.storePlayPng),
    darijaLines: await Promise.all(
      (input.assets?.darijaLinesPngs ?? []).map((b) => embedArt(doc, b))
    ),
    decor: (
      await Promise.all(
        (input.assets?.decorPngs ?? []).map((b) => embedArt(doc, b))
      )
    ).filter((i): i is PDFImage => i !== null),
    artRecto: await embedArt(doc, input.artRecto),
    artVerso: await embedArt(doc, input.artVerso),
    tpl: getCardTemplate(input.templateKey),
    displayName,
    printTitle: input.printTitle !== false,
    printValidAll: input.printValidAll === true,
  };

  const base = input.baseUrl.replace(/\/+$/, "");
  const pageW = mm(CARD_PDF_GEOM.pageW);
  const pageH = mm(CARD_PDF_GEOM.pageH);

  // QR du verso : le SITE (lien affiché en clair dessous) — identique sur
  // toutes les cartes, calculé une seule fois.
  const siteMatrix = await qrMatrix(base, { margin: 0 });
  const siteHost = base.replace(/^https?:\/\//, "");

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
    drawVerso(verso, ctx, code, siteMatrix, siteHost);
    drawSlugInfo(
      verso,
      `Coligo · carte ${i + 1}/${input.cards.length} · verso`,
      fonts
    );
  }

  return doc.save();
}
