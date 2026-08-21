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
import sharp from "sharp";
import { qrMatrix } from "@/lib/ticket/qr-svg";
import {
  FLYER,
  FLYER_THEMES,
  INK,
  LOYALTY_CARD,
  type FlyerThemeKey,
} from "@/lib/design/tokens";
import { pdfColor } from "@/lib/pdf/pdf-kit";

// =============================================================================
// FLYER PUBLICITAIRE Coligo — recto/verso, DIMENSIONS LIBRES en centimètres
// (choisies par l'admin). Design inspiré des flyers « app » modernes
// (référence Pinterest fournie par le propriétaire) : fond dégradé violet →
// rose plein cadre avec formes flottantes inclinées, typo géante mixte
// (script FR + énorme accroche DARIJA en PNG — pdf-lib ne shape pas l'arabe),
// VRAI mockup téléphone avec les captures RÉELLES de l'app (marketplace au
// recto, fiche commerçant au verso), pilules d'avantages, QR de
// téléchargement et badges App Store / Google Play (vrais logos fournis).
//
// Le TEXTE parle le marché algérien : darija (PNG arabes pré-rendus Segoe UI)
// + darija latinisée mélangée au français (« Wech testenna ? », « kima
// theb »…) — jamais d'arabe littéraire, jamais d'italique sur l'arabe.
//
// Tout est PROPORTIONNEL à la taille demandée (unités = fractions de page) :
// un A6 comme un A3 sortent équilibrés. Fond = SVG dégradé rendu par sharp à
// la taille exacte (aucun texte dans le SVG — pas de dépendance fontconfig).
// =============================================================================

const M = 72 / 25.4; // 1 mm en points PDF
const mm = (n: number) => n * M;

const WHITE = pdfColor(LOYALTY_CARD.paper);
const VIOLET_INK = pdfColor(LOYALTY_CARD.qrInk);
const BADGE_BLACK = pdfColor(LOYALTY_CARD.badgeInk);
const INK_WHITE = INK.white;
const BLACK = pdfColor(INK.black);
const PHONE_FRAME = pdfColor(FLYER.phoneFrame);

export type FlyerAssets = {
  /** Logotype Coligo blanc (public/brand/logo-full-white.png). */
  logoWhitePng?: Uint8Array | null;
  /** Captures RÉELLES de l'app (public/brand/flyer/, coins pré-arrondis). */
  screenMarketplacePng?: Uint8Array | null;
  screenStorePng?: Uint8Array | null;
  /** Vrais logos stores (public/brand/store-*.png). */
  storeApplePng?: Uint8Array | null;
  storePlayPng?: Uint8Array | null;
  /** Carlito-BoldItalic (titres/script). */
  titleFontBytes?: Uint8Array | null;
  /** Accroches darija pré-rendues (public/brand/flyer/darija-*.png). */
  hookKolchPng?: Uint8Array | null; // « كلش يوصلك »
  hookChriPng?: Uint8Array | null; // « شري و تهنّى »
  hookWinPng?: Uint8Array | null; // « وين ما تكون »
};

/** Catalogue des PHRASES d'avantages (pilules du recto) — partagé avec la
 *  console admin (labels + choix). Darija latinisée assumée. */
export const FLYER_PERKS: { icon: keyof typeof ICONS; label: string }[] = [
  { icon: "percent", label: "PROMOS & RÉDUCTIONS" },
  { icon: "cart", label: "COMMANDE À L'AVANCE" },
  { icon: "truck", label: "LIVRAISON À DOMICILE" },
  { icon: "card", label: "CARTE WELA CASH" },
  { icon: "gift", label: "CARTE DE FIDÉLITÉ" },
  { icon: "percent", label: "PROMOS EN DIRECT" },
  { icon: "cart", label: "RÉCUPÈRE BLA MA DIR LACHAINE" },
  { icon: "card", label: "DAHABIA, CIB WELA CASH" },
];
export const FLYER_DEFAULT_PERKS = [0, 1, 2, 3, 4];

/** Accroches DARIJA (PNG pré-rendus) proposées à la console. */
export const FLYER_HOOKS = {
  kolch: "كلش يوصلك — tout t'arrive",
  chri: "شري و تهنّى — achète tranquille",
  win: "وين ما تكون — où que tu sois",
} as const;
export type FlyerHookKey = keyof typeof FLYER_HOOKS;

export type FlyerInput = {
  widthCm: number;
  heightCm: number;
  baseUrl: string;
  /** Modèle couleur (FLYER_THEMES) — défaut : violet. */
  theme?: FlyerThemeKey;
  /** Accroche darija du recto — défaut : kolch (« كلش يوصلك »). */
  hook?: FlyerHookKey;
  /** Phrase script du recto (latin) — défaut : « Wech testenna ? ». */
  scriptText?: string;
  /** Indices FLYER_PERKS des pilules du recto (max 5) — défaut 0..4. */
  perkIndices?: number[];
  assets?: FlyerAssets;
};

type Ctx = {
  W: number; // largeur page en mm
  H: number;
  scriptText: string;
  perkIndices: number[];
  hookImg: PDFImage | null;
  fonts: { reg: PDFFont; bold: PDFFont; title: PDFFont };
  logo: PDFImage | null;
  screenMarket: PDFImage | null;
  screenStore: PDFImage | null;
  storeApple: PDFImage | null;
  storePlay: PDFImage | null;
  hookKolch: PDFImage | null;
  hookChri: PDFImage | null;
  hookWin: PDFImage | null;
  bg: PDFImage | null;
};

/* ─────────────────────────── primitives (origine 0,0) ───────────────────── */

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
  page.drawText(s, { x: mm(x), y: mm(y), size, font, color, opacity });
}

function wOf(s: string, font: PDFFont, size: number): number {
  return font.widthOfTextAtSize(s, size) / M;
}

function fitSize(
  s: string,
  font: PDFFont,
  start: number,
  maxWidthMm: number,
  min = 4
): number {
  let size = start;
  while (size > min && font.widthOfTextAtSize(s, size) > mm(maxWidthMm)) {
    size -= 0.5;
  }
  return size;
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
  page.drawSvgPath(p, { x: mm(x), y: mm(y + h), scale: M, color, opacity });
}

/** Image posée par sa hauteur (ratio gardé). Renvoie la largeur (mm). */
function image(
  page: PDFPage,
  img: PDFImage,
  x: number,
  y: number,
  h: number
): number {
  const w = (img.width / img.height) * h;
  page.drawImage(img, { x: mm(x), y: mm(y), width: mm(w), height: mm(h) });
  return w;
}

/** Image posée par sa LARGEUR (ratio gardé). Renvoie la hauteur (mm). */
function imageW(
  page: PDFPage,
  img: PDFImage,
  x: number,
  y: number,
  w: number
): number {
  const h = (img.height / img.width) * w;
  page.drawImage(img, { x: mm(x), y: mm(y), width: mm(w), height: mm(h) });
  return h;
}

/** Icône lucide (viewBox 24) au trait, bouts ronds. */
function drawIcon(
  page: PDFPage,
  icon: { paths: string[]; dots: { cx: number; cy: number; r: number }[] },
  x: number,
  y: number,
  sizeMm: number,
  color: ReturnType<typeof rgb>
) {
  const scale = mm(sizeMm) / 24;
  const strokeW = mm(sizeMm) / 11;
  for (const d of icon.paths) {
    page.drawSvgPath(d, {
      x: mm(x),
      y: mm(y + sizeMm),
      scale,
      borderColor: color,
      borderWidth: strokeW,
      borderLineCap: LineCapStyle.Round,
    });
  }
  for (const c of icon.dots) {
    page.drawEllipse({
      x: mm(x) + c.cx * scale,
      y: mm(y + sizeMm) - c.cy * scale,
      xScale: c.r * scale,
      yScale: c.r * scale,
      borderColor: color,
      borderWidth: strokeW,
    });
  }
}

const ICONS = {
  percent: {
    paths: ["M19 5 L5 19"],
    dots: [
      { cx: 6.5, cy: 6.5, r: 2.5 },
      { cx: 17.5, cy: 17.5, r: 2.5 },
    ],
  },
  cart: {
    paths: [
      "M2.05 2.05h2l2.66 12.42a2 2 0 0 0 2 1.58h9.78a2 2 0 0 0 1.95-1.57l1.65-7.43H5.12",
    ],
    dots: [
      { cx: 8, cy: 21, r: 1 },
      { cx: 19, cy: 21, r: 1 },
    ],
  },
  truck: {
    paths: [
      "M14 18V6a2 2 0 0 0-2-2H4a2 2 0 0 0-2 2v11a1 1 0 0 0 1 1h2",
      "M15 18H9",
      "M19 18h2a1 1 0 0 0 1-1v-3.65a1 1 0 0 0-.22-.624l-3.48-4.35A1 1 0 0 0 17.52 8H14",
    ],
    dots: [
      { cx: 17, cy: 18, r: 2 },
      { cx: 7, cy: 18, r: 2 },
    ],
  },
  card: {
    paths: [
      "M4 5 H20 Q22 5 22 7 V17 Q22 19 20 19 H4 Q2 19 2 17 V7 Q2 5 4 5 Z",
      "M2 10 H22",
    ],
    dots: [],
  },
  gift: {
    paths: [
      "M4 8 H20 V12 H4 Z",
      "M12 8 V21",
      "M19 12 v7 a2 2 0 0 1 -2 2 H7 a2 2 0 0 1 -2 -2 v-7",
      "M7.5 8 a2.5 2.5 0 0 1 0 -5 A4.8 8 0 0 1 12 8 a4.8 8 0 0 1 4.5 -5 a2.5 2.5 0 0 1 0 5",
    ],
    dots: [],
  },
};

/* ─────────────────────────── fond dégradé (sharp) ───────────────────────── */

/** Fond plein cadre : dégradé diagonal violet → rose + formes flottantes
 *  inclinées (langage du flyer de référence) — SVG sans texte, rendu à la
 *  taille exacte demandée. */
async function renderBackground(
  wMm: number,
  hMm: number,
  theme: FlyerThemeKey
): Promise<Uint8Array> {
  const T = FLYER_THEMES[theme];
  const pxPerMm = Math.min(8, 2400 / Math.max(wMm, hMm));
  const W = Math.round(wMm * pxPerMm);
  const H = Math.round(hMm * pxPerMm);
  const u = Math.min(W, H) / 100;
  const svg = `<svg width="${W}" height="${H}" xmlns="http://www.w3.org/2000/svg">
  <defs>
    <linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${T.g1}"/>
      <stop offset="0.5" stop-color="${T.g2}"/>
      <stop offset="0.82" stop-color="${T.g3}"/>
      <stop offset="1" stop-color="${T.g4}"/>
    </linearGradient>
    <linearGradient id="p" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0" stop-color="${T.shape1}"/>
      <stop offset="1" stop-color="${T.shape2}"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#g)"/>
  <g opacity="0.9">
    <rect x="${W - 34 * u}" y="${-14 * u}" width="${34 * u}" height="${26 * u}" rx="${3 * u}" fill="url(#p)" transform="rotate(18 ${W - 17 * u} 0)"/>
    <rect x="${-16 * u}" y="${H - 20 * u}" width="${34 * u}" height="${26 * u}" rx="${3 * u}" fill="url(#p)" transform="rotate(18 0 ${H - 8 * u})"/>
  </g>
  <g fill="${INK_WHITE}" opacity="0.05">
    <rect x="${W * 0.52}" y="${-H * 0.1}" width="${16 * u}" height="${H * 1.2}" transform="skewX(-12)"/>
    <rect x="${W * 0.74}" y="${-H * 0.1}" width="${26 * u}" height="${H * 1.2}" transform="skewX(-12)"/>
  </g>
  <rect x="${W * 0.62}" y="${H * 0.16}" width="${34 * u}" height="${34 * u}" rx="${8 * u}" fill="none" stroke="${INK_WHITE}" stroke-opacity="0.08" stroke-width="${1.2 * u}" transform="rotate(12 ${W * 0.62 + 17 * u} ${H * 0.16 + 17 * u})"/>
</svg>`;
  return new Uint8Array(
    await sharp(Buffer.from(svg)).png({ compressionLevel: 9 }).toBuffer()
  );
}

/* ─────────────────────────── briques communes ───────────────────────────── */

/** QR sur panneau blanc arrondi, modules violets. */
function drawQr(
  page: PDFPage,
  matrix: boolean[][],
  x: number,
  y: number,
  size: number
) {
  const pad = size * 0.09;
  roundedRect(page, x, y, size, size, size * 0.12, WHITE);
  const n = matrix.length;
  const qr = size - 2 * pad;
  const cell = qr / n;
  const left = x + pad;
  const top = y + pad + qr;
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
          color: VIOLET_INK,
        });
        run = -1;
      }
    }
  }
}

/** Badge store noir arrondi avec le VRAI logo + libellés. */
function drawStoreBadge(
  page: PDFPage,
  ctx: Ctx,
  x: number,
  y: number,
  w: number,
  h: number,
  kind: "apple" | "play"
) {
  roundedRect(page, x, y, w, h, h * 0.22, BADGE_BLACK);
  const img = kind === "apple" ? ctx.storeApple : ctx.storePlay;
  const logoH = h * 0.56;
  let logoW = logoH;
  if (img) logoW = image(page, img, x + h * 0.28, y + (h - logoH) / 2, logoH);
  const tx = x + h * 0.28 + logoW + h * 0.18;
  const cap = kind === "apple" ? "Télécharge sur l'" : "Disponible sur";
  const store = kind === "apple" ? "App Store" : "Google Play";
  const capSize = h * 0.28 * M * 0.62;
  text(page, cap, tx, y + h * 0.56, capSize, ctx.fonts.reg, WHITE, 0.85);
  // Borné en hauteur : « App Store » (court) ne doit pas grossir plus que le badge.
  const storeSize = Math.min(
    fitSize(store, ctx.fonts.bold, h * 0.42 * M, w - (tx - x) - h * 0.2, 4),
    h * 0.34 * M
  );
  text(page, store, tx, y + h * 0.16, storeSize, ctx.fonts.bold, WHITE);
}

/** Mockup téléphone : cadre sombre arrondi + capture RÉELLE (pré-arrondie). */
function drawPhone(
  page: PDFPage,
  screen: PDFImage | null,
  x: number,
  y: number,
  w: number
) {
  if (!screen) return;
  const frame = w * 0.045;
  const screenW = w - 2 * frame;
  const screenH = (screen.height / screen.width) * screenW;
  const h = screenH + 2 * frame;
  // Ombre douce (décalée) puis cadre.
  roundedRect(page, x + w * 0.035, y - w * 0.045, w, h, w * 0.115, BLACK, 0.28);
  roundedRect(page, x, y, w, h, w * 0.115, PHONE_FRAME);
  page.drawImage(screen, {
    x: mm(x + frame),
    y: mm(y + frame),
    width: mm(screenW),
    height: mm(screenH),
  });
  // Encoche.
  roundedRect(
    page,
    x + w * 0.34,
    y + h - frame - w * 0.035,
    w * 0.32,
    w * 0.028,
    w * 0.014,
    PHONE_FRAME
  );
}

/** Bande basse : QR + « scanne » + badges stores + site. Hauteur ≈ 0.16H. */
function drawBottomBand(
  page: PDFPage,
  ctx: Ctx,
  matrix: boolean[][],
  siteHost: string
) {
  const { W, fonts } = ctx;
  const m = W * 0.06;
  const bandH = Math.min(W * 0.24, ctx.H * 0.17);
  roundedRect(
    page,
    m * 0.55,
    m * 0.5,
    W - m * 1.1,
    bandH,
    W * 0.03,
    WHITE,
    0.1
  );
  const qrSize = bandH * 0.72;
  const qrY = m * 0.5 + (bandH - qrSize) / 2;
  drawQr(page, matrix, m * 0.95, qrY, qrSize);
  const tx = m * 0.95 + qrSize + W * 0.025;
  const scanSize = fitSize(
    "Scanni, téléchargi, w commandi !",
    fonts.bold,
    W * 0.155,
    W * 0.4,
    5
  );
  text(
    page,
    "Scanni, téléchargi,",
    tx,
    qrY + qrSize * 0.72,
    scanSize,
    fonts.bold,
    WHITE
  );
  text(
    page,
    "w commandi !",
    tx,
    qrY + qrSize * 0.72 - scanSize / M - 1,
    scanSize,
    fonts.bold,
    WHITE
  );
  const siteSize = W * 0.11;
  text(
    page,
    siteHost,
    tx,
    qrY + qrSize * 0.08,
    siteSize,
    fonts.title,
    WHITE,
    0.95
  );
  // Badges empilés à droite — répartis EXACTEMENT sur la hauteur du QR
  // (PIÈGE vécu : 2 × 0.42·bande > QR → le badge Play recouvrait l'autre).
  const bw = W * 0.24;
  const bh = qrSize / 2 - 0.9;
  const bx = W - m * 0.55 - bw - W * 0.02;
  drawStoreBadge(page, ctx, bx, qrY + qrSize - bh, bw, bh, "apple");
  drawStoreBadge(page, ctx, bx, qrY, bw, bh, "play");
}

/* ─────────────────────────────── RECTO ──────────────────────────────────── */

function drawRecto(
  page: PDFPage,
  ctx: Ctx,
  matrix: boolean[][],
  siteHost: string
) {
  const { W, H, fonts } = ctx;
  const m = W * 0.06;
  if (ctx.bg) {
    page.drawImage(ctx.bg, { x: 0, y: 0, width: mm(W), height: mm(H) });
  }

  // Logo Coligo — coin haut gauche.
  if (ctx.logo)
    image(page, ctx.logo, m * 0.9, H - m * 0.7 - W * 0.085, W * 0.085);

  // Téléphone à droite : la MARKETPLACE réelle de l'app.
  const phoneW = W * 0.4;
  drawPhone(page, ctx.screenMarket, W * 0.56, H * 0.17, phoneW);

  // Script d'accroche (darija latinisée) + ÉNORME hook arabe.
  const script = ctx.scriptText;
  const scriptSize = fitSize(script, fonts.title, W * 0.32, W * 0.88, 8);
  text(page, script, m, H * 0.815, scriptSize, fonts.title, WHITE);
  if (ctx.hookImg) {
    imageW(page, ctx.hookImg, m, H * 0.7, W * 0.44);
  }
  const sub = "Tes commerces, promos w livraison";
  const sub2 = "— f'une seule appli.";
  const subSize = fitSize(sub, fonts.bold, W * 0.155, W * 0.44, 5);
  text(page, sub, m, H * 0.645, subSize, fonts.bold, WHITE, 0.95);
  text(
    page,
    sub2,
    m,
    H * 0.645 - subSize / M - 1.2,
    subSize,
    fonts.bold,
    WHITE,
    0.95
  );

  // Pilules d'avantages (colonne gauche, à côté du téléphone).
  const perks = ctx.perkIndices
    .map((i) => FLYER_PERKS[i])
    .filter(Boolean)
    .map((p) => ({ icon: ICONS[p.icon], label: p.label }));
  const pillH = Math.min(H * 0.052, W * 0.085);
  const pillGap = pillH * 0.38;
  let py = H * 0.575 - pillH;
  for (const p of perks) {
    const size = fitSize(p.label, fonts.bold, pillH * M * 0.42, W * 0.34, 4);
    const pw = pillH * 1.15 + wOf(p.label, fonts.bold, size) + pillH * 0.5;
    roundedRect(page, m, py, pw, pillH, pillH / 2, WHITE);
    drawIcon(
      page,
      p.icon,
      m + pillH * 0.28,
      py + pillH * 0.2,
      pillH * 0.6,
      VIOLET_INK
    );
    text(
      page,
      p.label,
      m + pillH * 1.1,
      py + pillH * 0.32,
      size,
      fonts.bold,
      VIOLET_INK
    );
    py -= pillH + pillGap;
  }

  drawBottomBand(page, ctx, matrix, siteHost);
}

/* ─────────────────────────────── VERSO ──────────────────────────────────── */

function drawVerso(
  page: PDFPage,
  ctx: Ctx,
  matrix: boolean[][],
  siteHost: string
) {
  const { W, H, fonts } = ctx;
  const m = W * 0.06;
  if (ctx.bg) {
    page.drawImage(ctx.bg, { x: 0, y: 0, width: mm(W), height: mm(H) });
  }

  // En-tête : logo centré + hook « شري و تهنّى » + sous-titre FR.
  if (ctx.logo) {
    const lw = (ctx.logo.width / ctx.logo.height) * (W * 0.07);
    image(page, ctx.logo, (W - lw) / 2, H - m * 0.6 - W * 0.07, W * 0.07);
  }
  if (ctx.hookChri) {
    const hw = W * 0.5;
    imageW(page, ctx.hookChri, (W - hw) / 2, H * 0.795, hw);
  }
  const sub = "Tes commerces préférés, dans ta poche.";
  const subSize = fitSize(sub, fonts.title, W * 0.17, W * 0.8, 5);
  const subW = wOf(sub, fonts.title, subSize);
  text(page, sub, (W - subW) / 2, H * 0.755, subSize, fonts.title, WHITE, 0.95);

  // Téléphone à gauche : une VRAIE fiche commerçant (offres, code promo).
  const phoneW = W * 0.36;
  drawPhone(page, ctx.screenStore, m * 0.9, H * 0.205, phoneW);

  // Colonne droite : les promesses, GRANDES et en GRAS, sous-titre darija.
  const colX = W * 0.5;
  const colW = W - colX - m;
  const services = [
    {
      icon: ICONS.percent,
      t: "PROMOS EN DIRECT",
      d: "Réductions kol nhar, offres flash.",
    },
    {
      icon: ICONS.cart,
      t: "COMMANDE À L'AVANCE",
      d: "Retire f'5 minutes, sans file.",
    },
    {
      icon: ICONS.truck,
      t: "LIVRAISON À DOMICILE",
      d: "Ywasslouk hatta l'bab eddar.",
    },
    { icon: ICONS.card, t: "CARTE WELA CASH", d: "Khallas kima theb." },
    {
      icon: ICONS.gift,
      t: "CARTE DE FIDÉLITÉ",
      d: "Des avantages à chaque achat.",
    },
  ];
  const zoneTop = H * 0.7;
  const zoneBot = H * 0.235;
  const rowH = (zoneTop - zoneBot) / services.length;
  const iconS = Math.min(rowH * 0.42, W * 0.055);
  let sy = zoneTop;
  for (const s of services) {
    drawIcon(page, s.icon, colX, sy - iconS - rowH * 0.12, iconS, WHITE);
    const tx = colX + iconS + W * 0.02;
    const tSize = fitSize(
      s.t,
      fonts.bold,
      W * 0.155,
      colW - iconS - W * 0.02,
      5
    );
    text(page, s.t, tx, sy - rowH * 0.36, tSize, fonts.bold, WHITE);
    const dSize = fitSize(
      s.d,
      fonts.reg,
      W * 0.105,
      colW - iconS - W * 0.02,
      4
    );
    text(
      page,
      s.d,
      tx,
      sy - rowH * 0.36 - tSize / M - 0.9,
      dSize,
      fonts.reg,
      WHITE,
      0.82
    );
    sy -= rowH;
  }

  // « وين ما تكون » — coin haut gauche (répond au logo centré).
  if (ctx.hookWin) {
    const hw = W * 0.24;
    const hh = (ctx.hookWin.height / ctx.hookWin.width) * hw;
    imageW(page, ctx.hookWin, m * 0.9, H - m * 0.7 - hh, hw);
  }

  drawBottomBand(page, ctx, matrix, siteHost);
}

/* ─────────────────────────────── BUILDER ────────────────────────────────── */

async function embed(
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
    return null;
  }
}

export async function buildColigoFlyerPdf(
  input: FlyerInput
): Promise<Uint8Array> {
  // Bornes de sécurité : 5 cm à 100 cm par côté.
  const W = Math.min(100, Math.max(5, input.widthCm)) * 10;
  const H = Math.min(100, Math.max(5, input.heightCm)) * 10;

  const doc = await PDFDocument.create();
  doc.setTitle("Flyer Coligo");
  doc.setProducer("Coligo");
  doc.registerFontkit(fontkit);

  const titleBytes = input.assets?.titleFontBytes ?? null;
  const fonts = {
    reg: await doc.embedFont(StandardFonts.Helvetica),
    bold: await doc.embedFont(StandardFonts.HelveticaBold),
    // PIÈGE connu : subset corrompt le cmap — police entière.
    title:
      titleBytes && titleBytes.length > 0
        ? await doc.embedFont(titleBytes)
        : await doc.embedFont(StandardFonts.HelveticaBoldOblique),
  };

  const hookKolch = await embed(doc, input.assets?.hookKolchPng);
  const hookChri = await embed(doc, input.assets?.hookChriPng);
  const hookWin = await embed(doc, input.assets?.hookWinPng);
  const hookImg =
    input.hook === "chri"
      ? hookChri
      : input.hook === "win"
        ? hookWin
        : hookKolch;
  const perkIndices = (
    input.perkIndices && input.perkIndices.length > 0
      ? input.perkIndices
      : FLYER_DEFAULT_PERKS
  ).slice(0, 5);

  const ctx: Ctx = {
    W,
    H,
    scriptText: (input.scriptText ?? "Wech testenna ?").slice(0, 40),
    perkIndices,
    hookImg,
    fonts,
    logo: await embed(doc, input.assets?.logoWhitePng),
    screenMarket: await embed(doc, input.assets?.screenMarketplacePng),
    screenStore: await embed(doc, input.assets?.screenStorePng),
    storeApple: await embed(doc, input.assets?.storeApplePng),
    storePlay: await embed(doc, input.assets?.storePlayPng),
    hookKolch,
    hookChri,
    hookWin,
    bg: await embed(doc, await renderBackground(W, H, input.theme ?? "violet")),
  };

  const base = input.baseUrl.replace(/\/+$/, "");
  const siteHost = base.replace(/^https?:\/\//, "");
  const matrix = await qrMatrix(`${base}/app`, { margin: 0 });

  const recto = doc.addPage([mm(W), mm(H)]);
  drawRecto(recto, ctx, matrix, siteHost);
  const verso = doc.addPage([mm(W), mm(H)]);
  drawVerso(verso, ctx, matrix, siteHost);

  return doc.save();
}
