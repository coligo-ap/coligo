import {
  LineCapStyle,
  PDFDocument,
  StandardFonts,
  rgb,
  type PDFFont,
  type PDFImage,
  type PDFPage,
} from "pdf-lib";
import fontkit from "@pdf-lib/fontkit";
import { qrMatrix } from "@/lib/ticket/qr-svg";
import { LOYALTY_CARD } from "@/lib/design/tokens";
import { PDF_INK, pdfColor } from "@/lib/pdf/pdf-kit";
import { CARD_PDF_GEOM } from "@/lib/loyalty/card-pdf";

// =============================================================================
// CARTE DE VISITE Coligo — format CR80 85,6 × 54 mm, même chaîne d'impression
// que les cartes de fidélité (fonds perdus 3 mm + traits de coupe, une carte
// par page recto puis verso). Recto : fond dégradé violet de marque, logotype
// centré, baseline. Verso : contacts en GRAND (téléphone, e-mail, site,
// Facebook / Instagram « Coligo App ») + QR du site sur panneau blanc.
// Généré à la volée, jamais stocké.
// =============================================================================

const M = 72 / 25.4;
const mm = (n: number) => n * M;

const WHITE = pdfColor(LOYALTY_CARD.paper);
const QR_INK = pdfColor(LOYALTY_CARD.qrInk);

export type BusinessCardInput = {
  phone: string;
  email: string;
  baseUrl: string;
  assets?: {
    /** Fond dégradé violet (loyalty-card-bg-violet.png, fonds perdus compris). */
    backgroundPng?: Uint8Array | null;
    /** Logotype Coligo blanc FR+AR. */
    logoPng?: Uint8Array | null;
    /** Carlito-BoldItalic pour la baseline. */
    titleFontBytes?: Uint8Array | null;
  };
};

type Fonts = { reg: PDFFont; bold: PDFFont; title: PDFFont };

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

function wOf(s: string, font: PDFFont, size: number): number {
  return font.widthOfTextAtSize(s, size) / M;
}

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

/** Icône lucide au trait blanc, bouts ronds. */
function drawIcon(
  page: PDFPage,
  paths: string[],
  dots: { cx: number; cy: number; r: number }[],
  x: number,
  y: number,
  sizeMm: number
) {
  const o = CARD_PDF_GEOM.origin;
  const scale = mm(sizeMm) / 24;
  const strokeW = mm(sizeMm) / 11;
  for (const d of paths) {
    page.drawSvgPath(d, {
      x: mm(o + x),
      y: mm(o + y + sizeMm),
      scale,
      borderColor: WHITE,
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
      color: WHITE,
    });
  }
}

const ICON_PHONE = {
  paths: [
    "M22 16.92v3a2 2 0 0 1-2.18 2 19.79 19.79 0 0 1-8.63-3.07 19.5 19.5 0 0 1-6-6 19.79 19.79 0 0 1-3.07-8.67A2 2 0 0 1 4.11 2h3a2 2 0 0 1 2 1.72 12.84 12.84 0 0 0 .7 2.81 2 2 0 0 1-.45 2.11L8.09 9.91a16 16 0 0 0 6 6l1.27-1.27a2 2 0 0 1 2.11-.45 12.84 12.84 0 0 0 2.81.7A2 2 0 0 1 22 16.92z",
  ],
  dots: [],
};
const ICON_MAIL = {
  paths: [
    "M4 4 H20 Q22 4 22 6 V18 Q22 20 20 20 H4 Q2 20 2 18 V6 Q2 4 4 4 Z",
    "M22 7 L13.03 12.7 a1.94 1.94 0 0 1 -2.06 0 L2 7",
  ],
  dots: [],
};
const ICON_GLOBE = {
  paths: ["M2 12 H22", "M12 2 a14.5 14.5 0 0 0 0 20 a14.5 14.5 0 0 0 0 -20"],
  dots: [{ cx: 12, cy: 12, r: 10 }],
};

/** Globe : le cercle extérieur est un TRAIT, pas un disque. */
function drawGlobe(page: PDFPage, x: number, y: number, s: number) {
  const o = CARD_PDF_GEOM.origin;
  const scale = mm(s) / 24;
  const strokeW = mm(s) / 11;
  page.drawEllipse({
    x: mm(o + x) + 12 * scale,
    y: mm(o + y + s) - 12 * scale,
    xScale: 10 * scale,
    yScale: 10 * scale,
    borderColor: WHITE,
    borderWidth: strokeW,
  });
  for (const d of ICON_GLOBE.paths) {
    page.drawSvgPath(d, {
      x: mm(o + x),
      y: mm(o + y + s),
      scale,
      borderColor: WHITE,
      borderWidth: strokeW,
      borderLineCap: LineCapStyle.Round,
    });
  }
}

function drawSocial(
  page: PDFPage,
  fonts: Fonts,
  x: number,
  y: number,
  s: number,
  kind: "facebook" | "instagram"
) {
  const o = CARD_PDF_GEOM.origin;
  if (kind === "facebook") {
    page.drawEllipse({
      x: mm(o + x + s / 2),
      y: mm(o + y + s / 2),
      xScale: mm(s / 2),
      yScale: mm(s / 2),
      color: WHITE,
    });
    const fSize = s * M * 0.72;
    const fw = wOf("f", fonts.bold, fSize);
    text(
      page,
      "f",
      x + (s - fw) / 2 + 0.1,
      y + s * 0.14,
      fSize,
      fonts.bold,
      QR_INK
    );
  } else {
    const stroke = mm(s) / 11;
    page.drawSvgPath(
      `M ${s * 0.26} 0 H ${s * 0.74} Q ${s} 0 ${s} ${s * 0.26} V ${s * 0.74} Q ${s} ${s} ${s * 0.74} ${s} H ${s * 0.26} Q 0 ${s} 0 ${s * 0.74} V ${s * 0.26} Q 0 0 ${s * 0.26} 0 Z`,
      {
        x: mm(o + x),
        y: mm(o + y + s),
        scale: M,
        borderColor: WHITE,
        borderWidth: stroke,
      }
    );
    page.drawEllipse({
      x: mm(o + x + s / 2),
      y: mm(o + y + s / 2),
      xScale: mm(s * 0.22),
      yScale: mm(s * 0.22),
      borderColor: WHITE,
      borderWidth: stroke,
    });
    page.drawEllipse({
      x: mm(o + x + s * 0.76),
      y: mm(o + y + s * 0.76),
      xScale: mm(s * 0.055),
      yScale: mm(s * 0.055),
      color: WHITE,
    });
  }
}

function drawBackground(page: PDFPage, bg: PDFImage | null) {
  const g = CARD_PDF_GEOM;
  const o = g.origin;
  if (bg) {
    page.drawImage(bg, {
      x: mm(o - g.bleed),
      y: mm(o - g.bleed),
      width: mm(g.trimW + 2 * g.bleed),
      height: mm(g.trimH + 2 * g.bleed),
    });
  } else {
    page.drawRectangle({
      x: mm(o - g.bleed),
      y: mm(o - g.bleed),
      width: mm(g.trimW + 2 * g.bleed),
      height: mm(g.trimH + 2 * g.bleed),
      color: QR_INK,
    });
  }
}

function drawCropMarks(page: PDFPage) {
  const g = CARD_PDF_GEOM;
  const o = g.origin;
  const len = 4;
  const gap = g.bleed + 1;
  const ink = PDF_INK.INK;
  const line = (x1: number, y1: number, x2: number, y2: number) =>
    page.drawLine({
      start: { x: mm(x1), y: mm(y1) },
      end: { x: mm(x2), y: mm(y2) },
      thickness: 0.3,
      color: ink,
    });
  for (const y of [o, o + g.trimH]) {
    line(o - gap - len, y, o - gap, y);
    line(o + g.trimW + gap, y, o + g.trimW + gap + len, y);
  }
  for (const x of [o, o + g.trimW]) {
    line(x, o - gap - len, x, o - gap);
    line(x, o + g.trimH + gap, x, o + g.trimH + gap + len);
  }
}

export async function buildBusinessCardPdf(
  input: BusinessCardInput
): Promise<Uint8Array> {
  const g = CARD_PDF_GEOM;
  const doc = await PDFDocument.create();
  doc.setTitle("Carte de visite Coligo");
  doc.setProducer("Coligo");
  doc.registerFontkit(fontkit);

  const titleBytes = input.assets?.titleFontBytes ?? null;
  const fonts: Fonts = {
    reg: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    // PIÈGE connu : subset corrompt le cmap — police entière.
    title:
      titleBytes && titleBytes.length > 0
        ? await doc.embedFont(titleBytes)
        : await doc.embedFont(StandardFonts.HelveticaBoldOblique),
  };

  const bg = input.assets?.backgroundPng
    ? await doc.embedPng(input.assets.backgroundPng)
    : null;
  const logo = input.assets?.logoPng
    ? await doc.embedPng(input.assets.logoPng)
    : null;

  const base = input.baseUrl.replace(/\/+$/, "");
  const siteHost = base.replace(/^https?:\/\//, "");
  const matrix = await qrMatrix(base, { margin: 0 });

  const pageW = mm(g.pageW);
  const pageH = mm(g.pageH);

  // ── RECTO : logotype centré, baseline. ──────────────────────────────────
  const recto = doc.addPage([pageW, pageH]);
  drawBackground(recto, bg);
  if (logo) {
    const h = 13;
    const w = (logo.width / logo.height) * h;
    image(recto, logo, (g.trimW - w) / 2, 25, h);
  }
  {
    const baseline = "Tes commerces, dans ta poche.";
    const size = 8;
    const w = wOf(baseline, fonts.title, size);
    text(
      recto,
      baseline,
      (g.trimW - w) / 2,
      17.5,
      size,
      fonts.title,
      WHITE,
      0.95
    );
  }
  drawCropMarks(recto);

  // ── VERSO : contacts en GRAND + QR du site. ─────────────────────────────
  const verso = doc.addPage([pageW, pageH]);
  drawBackground(verso, bg);
  if (logo) {
    image(verso, logo, 4.5, 45, 6.2);
  }

  // QR site sur panneau blanc, à droite.
  const qrSize = 21;
  const qrX = g.trimW - 4.5 - qrSize;
  roundedRect(verso, qrX, 16, qrSize, qrSize, 2.2, WHITE);
  {
    const pad = 1.8;
    const n = matrix.length;
    const cell = (qrSize - 2 * pad) / n;
    const o = CARD_PDF_GEOM.origin;
    const left = o + qrX + pad;
    const top = o + 16 + pad + (qrSize - 2 * pad);
    for (let yy = 0; yy < n; yy++) {
      let run = -1;
      for (let xx = 0; xx <= n; xx++) {
        const on = xx < n && matrix[yy][xx];
        if (on && run < 0) run = xx;
        if (!on && run >= 0) {
          verso.drawRectangle({
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
  {
    const scan = "Scanne-moi";
    const size = 4;
    const w = wOf(scan, fonts.bold, size);
    text(verso, scan, qrX + (qrSize - w) / 2, 12, size, fonts.bold, WHITE, 0.9);
  }

  // Colonne contacts — GRANDS, gras, une info par ligne.
  const rows: {
    icon: "phone" | "mail" | "globe" | "facebook" | "instagram";
    label: string;
  }[] = [
    { icon: "phone", label: input.phone },
    { icon: "mail", label: input.email },
    { icon: "globe", label: `www.${siteHost}` },
    { icon: "facebook", label: "Coligo App" },
    { icon: "instagram", label: "Coligo App" },
  ];
  const iconS = 4.6;
  let y = 36.5;
  for (const r of rows) {
    if (r.icon === "phone") drawIcon(verso, ICON_PHONE.paths, [], 5, y, iconS);
    else if (r.icon === "mail")
      drawIcon(verso, ICON_MAIL.paths, [], 5, y, iconS);
    else if (r.icon === "globe") drawGlobe(verso, 5, y, iconS);
    else drawSocial(verso, fonts, 5, y, iconS, r.icon);
    const size = r.icon === "phone" ? 7.5 : 6;
    text(verso, r.label, 5 + iconS + 2.4, y + 1, size, fonts.bold, WHITE);
    y -= 7.3;
  }

  drawCropMarks(verso);
  return doc.save();
}
