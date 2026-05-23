/**
 * Builder HTML du ticket de commande — mise en page d'inspiration Deliveroo
 * adaptée à Coligo : très épurée, N&B, bandeau noir inversé pour le mode,
 * #ID énorme, articles groupés par catégorie, récap aligné à droite.
 *
 * Imprimable via `lib/native/printer.ts` (window.print() en PWA, SDK Sunmi en
 * APK). `printTicket()` injecte déjà `@page { size: <width>mm auto; margin: 0 }`
 * et un body avec font monospace — on ré-déclare ici ce qui est SPÉCIFIQUE
 * au ticket (sans-serif principale, monospace seulement pour les montants).
 *
 * Le QR du code de retrait est généré inline (SVG via @zxing/library, déjà
 * installé pour le scanner) — aucune dépendance ajoutée.
 */

import type { PrintWidth } from "@/lib/types";

export type TicketItem = {
  product_name: string;
  quantity: number;
  unit_price_da: number;
  line_total_da: number;
  /** Optionnel — si présent, l'item est groupé sous cette catégorie. */
  category_name?: string;
};

export type TicketOrder = {
  id: string;
  merchant_name: string;
  customer_name: string;
  customer_phone: string;
  pickup_code: string;
  pickup_slot_at: string;
  created_at: string;
  notes: string | null;
  total_da: number;
  service_fee_da: number;
  cashback_da: number;
  payment_method: "cash" | "online";
  payment_status: "pending" | "paid" | "failed" | "refunded";
  items: TicketItem[];
};

export type BuildTicketOptions = {
  width: PrintWidth;
  appName?: string;
  /** Mention « COPIE k/N » sur les multi-exemplaires. */
  copyLabel?: string;
};

export type BuiltTicket = {
  /** Fragment HTML (contenu de <body>), avec ses propres <style>. */
  html: string;
  widthMm: PrintWidth;
};

// ===========================================================================
// Helpers
// ===========================================================================

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function formatDA(amountDa: number): string {
  return (
    new Intl.NumberFormat("fr-DZ", { maximumFractionDigits: 0 }).format(
      Math.round(amountDa)
    ) + " DA"
  );
}

function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("fr-DZ", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatSubmitted(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString("fr-DZ", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const date = d.toLocaleDateString("fr-DZ", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
  });
  return `${time}, ${date}`;
}

function shortId(id: string): string {
  return id.slice(0, 6).toUpperCase();
}

/** Compte les unités d'une commande (somme arrondie des quantités). */
function totalUnits(items: TicketItem[]): number {
  return items.reduce((s, it) => s + Number(it.quantity || 0), 0);
}

/**
 * Regroupe les items par catégorie, ordre = première apparition (cart-order).
 * Les items sans catégorie tombent dans un groupe « ARTICLES ».
 */
function groupByCategory(items: TicketItem[]): Array<{
  title: string;
  items: TicketItem[];
}> {
  const order: string[] = [];
  const map = new Map<string, TicketItem[]>();
  for (const it of items) {
    const key = it.category_name?.trim() || "Articles";
    if (!map.has(key)) {
      map.set(key, []);
      order.push(key);
    }
    map.get(key)!.push(it);
  }
  return order.map((title) => ({ title, items: map.get(title)! }));
}

/**
 * Encode `text` en QR (BitMatrix via @zxing/library) puis renvoie un SVG N&B
 * pur. Import dynamique : aucun bundle supplémentaire pour les écrans qui
 * n'impriment pas.
 */
async function qrSvg(text: string, sizePx: number): Promise<string> {
  const { QRCodeWriter, BarcodeFormat, EncodeHintType } =
    await import("@zxing/library");
  const writer = new QRCodeWriter();
  const hints = new Map<unknown, unknown>();
  hints.set(EncodeHintType.MARGIN, 0);
  const matrix = writer.encode(
    text,
    BarcodeFormat.QR_CODE,
    0,
    0,
    hints as Map<typeof EncodeHintType.MARGIN, number>
  );
  const w = matrix.getWidth();
  const h = matrix.getHeight();
  let path = "";
  for (let y = 0; y < h; y++) {
    for (let x = 0; x < w; x++) {
      if (matrix.get(x, y)) path += `M${x},${y}h1v1h-1z`;
    }
  }
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${sizePx}" height="${sizePx}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}

/** Mini logo Coligo en SVG N&B (carré noir + lettre C blanche centrée). */
function coligoMark(sizePx: number): string {
  const r = Math.round(sizePx / 5);
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" width="${sizePx}" height="${sizePx}"><rect width="24" height="24" rx="${r}" fill="#000"/><text x="12" y="17.5" text-anchor="middle" font-family="Inter, -apple-system, sans-serif" font-size="17" font-weight="800" fill="#fff">C</text></svg>`;
}

// ===========================================================================
// Builder principal
// ===========================================================================

export async function buildTicketHTML(
  order: TicketOrder,
  opts: BuildTicketOptions
): Promise<BuiltTicket> {
  const w = opts.width;
  const isWide = w === 80;

  // Tailles : un point haut sur 80mm, baseline lisible à 58mm. La hiérarchie
  // « #ID » > « code retrait » > « heure » > « total » est dominante.
  const fs = {
    micro: isWide ? 9 : 8,
    small: isWide ? 11 : 10,
    base: isWide ? 13 : 11,
    medium: isWide ? 15 : 13,
    large: isWide ? 19 : 16,
    h2: isWide ? 26 : 22,
    huge: isWide ? 44 : 36, // #ID + code retrait
  };
  const qrSize = isWide ? 180 : 140;
  const logoSize = isWide ? 22 : 18;

  const isPaidOnline =
    order.payment_method === "online" && order.payment_status === "paid";
  const isCash = order.payment_method === "cash";
  // Bandeau = mode dominant pour le commerçant qui colle le ticket sur le sac
  const bannerLabel = isPaidOnline
    ? "PAYÉ EN LIGNE"
    : isCash
      ? "À ENCAISSER"
      : "RETRAIT";

  const subtotal = order.items.reduce((s, it) => s + it.line_total_da, 0);
  const discount = Math.max(
    0,
    subtotal + order.service_fee_da - order.total_da
  );
  const units = totalUnits(order.items);

  // 8. Articles groupés
  const groups = groupByCategory(order.items);
  const itemsHtml = groups
    .map((g) => {
      const rows = g.items
        .map((it) => {
          const qty = String(it.quantity).replace(/\.0+$/, "");
          return `
            <div class="item-row">
              <span class="item-qty">${escapeHtml(qty)}×</span>
              <span class="item-name">${escapeHtml(it.product_name)}</span>
            </div>`;
        })
        .join("");
      const count = g.items.reduce((s, it) => s + Number(it.quantity || 0), 0);
      const countStr = String(count).replace(/\.0+$/, "");
      return `
        <div class="cat-group">
          <div class="cat-title">${escapeHtml(g.title.toUpperCase())} (${countStr})</div>
          ${rows}
        </div>`;
    })
    .join("");

  // 6. Note client mise en avant
  const noteHtml =
    order.notes && order.notes !== "seed"
      ? `
        <div class="note-block">
          <div class="note-label">NOTE CLIENT</div>
          <div class="note-body">${escapeHtml(order.notes)}</div>
        </div>
        <div class="dotted"></div>`
      : "";

  // 10. Récap aligné à droite
  const recapRows: string[] = [];
  recapRows.push(
    `<tr><td class="r-l">Nb d'articles</td><td class="r-v">${escapeHtml(String(units).replace(/\.0+$/, ""))}</td></tr>`
  );
  if (discount > 0 || order.service_fee_da > 0) {
    recapRows.push(
      `<tr><td class="r-l">Sous-total</td><td class="r-v">${escapeHtml(formatDA(subtotal))}</td></tr>`
    );
  }
  if (order.service_fee_da > 0) {
    recapRows.push(
      `<tr><td class="r-l">Frais de service</td><td class="r-v">${escapeHtml(formatDA(order.service_fee_da))}</td></tr>`
    );
  }
  if (discount > 0) {
    recapRows.push(
      `<tr><td class="r-l">Réduction</td><td class="r-v">-${escapeHtml(formatDA(discount))}</td></tr>`
    );
  }
  if (order.cashback_da > 0) {
    recapRows.push(
      `<tr><td class="r-l">Cashback</td><td class="r-v">-${escapeHtml(formatDA(order.cashback_da))}</td></tr>`
    );
  }
  recapRows.push(
    `<tr class="total-row"><td class="r-l">TOTAL</td><td class="r-v">${escapeHtml(formatDA(order.total_da))}</td></tr>`
  );

  // 11. Repère paiement final (mirror du bandeau, avec montant si cash)
  const paymentFooter = isPaidOnline
    ? `<div class="pay-final paid">&#10003; PAYÉ EN LIGNE</div>`
    : isCash
      ? `<div class="pay-final cash">À ENCAISSER : ${escapeHtml(formatDA(order.total_da))}</div>`
      : "";

  const copyBanner = opts.copyLabel
    ? `<div class="copy-banner">${escapeHtml(opts.copyLabel)}</div>`
    : "";

  const qr = await qrSvg(order.pickup_code, qrSize);

  // ---- Styles : sans-serif globale, monospace pour les colonnes alignées.
  // Le bandeau noir nécessite `print-color-adjust: exact` pour s'imprimer en
  // aplat sur les thermiques (sans ça, Chrome blanchit les fonds par défaut).
  const styles = `
    .ticket { color: #000; font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Inter, sans-serif; font-size: ${fs.base}px; line-height: 1.3; -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    .ticket .mono { font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace; }
    .ticket .center { text-align: center; }
    .ticket .dotted { border-top: 1px dashed #000; margin: 6px 0; }
    .ticket .copy-banner { text-align: center; font-weight: 800; font-size: ${fs.small}px; padding: 2px 0; border: 1px solid #000; margin-bottom: 4px; letter-spacing: 2px; }

    /* 1. Header logo + nom commerce */
    .ticket .brand { display: flex; align-items: center; justify-content: center; gap: 6px; }
    .ticket .brand .name { font-weight: 700; font-size: ${fs.base}px; }

    /* 2. Bandeau noir inversé — mode dominant */
    .ticket .banner { background: #000; color: #fff; text-align: center; font-weight: 900; letter-spacing: 2px; font-size: ${fs.large}px; padding: 6px 0; margin: 6px 0 4px; -webkit-print-color-adjust: exact; print-color-adjust: exact; }

    /* 3. #ID énorme */
    .ticket .order-id { font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace; font-weight: 900; font-size: ${fs.huge}px; line-height: 1; text-align: center; letter-spacing: 1px; margin: 4px 0 2px; }
    /* 4. Heure de retrait */
    .ticket .pickup-time-label { text-align: center; font-size: ${fs.small}px; text-transform: uppercase; letter-spacing: 1px; }
    .ticket .pickup-time { text-align: center; font-weight: 800; font-size: ${fs.h2}px; line-height: 1; margin: 2px 0 4px; }

    /* 6. Note client */
    .ticket .note-block { padding: 4px 6px; border: 1px solid #000; }
    .ticket .note-label { font-size: ${fs.micro}px; font-weight: 800; letter-spacing: 1px; }
    .ticket .note-body { font-size: ${fs.base}px; font-weight: 600; margin-top: 2px; }

    /* 8. Articles groupés par catégorie */
    .ticket .cat-group { margin: 4px 0; }
    .ticket .cat-title { font-weight: 800; font-size: ${fs.small}px; letter-spacing: 1px; margin-bottom: 2px; }
    .ticket .item-row { display: flex; align-items: baseline; gap: 4px; font-size: ${fs.base}px; }
    .ticket .item-qty { font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace; font-weight: 700; min-width: 2.4em; }
    .ticket .item-name { flex: 1; word-break: break-word; }

    /* 10. Récap aligné à droite */
    .ticket .recap { width: 100%; border-collapse: collapse; margin-top: 2px; }
    .ticket .recap td { padding: 1px 0; vertical-align: top; }
    .ticket .recap .r-l { text-align: left; font-size: ${fs.small}px; }
    .ticket .recap .r-v { text-align: right; font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace; font-size: ${fs.small}px; white-space: nowrap; }
    .ticket .recap .total-row .r-l, .ticket .recap .total-row .r-v { font-weight: 900; font-size: ${fs.medium}px; padding-top: 4px; }

    /* 11. Repère paiement */
    .ticket .pay-final { text-align: center; font-weight: 900; font-size: ${fs.medium}px; padding: 4px 0; border: 1.5px solid #000; margin-top: 4px; }

    /* 12-13. Soumis le / Client */
    .ticket .meta { display: flex; justify-content: space-between; font-size: ${fs.small}px; gap: 6px; }
    .ticket .meta .label { font-weight: 700; }

    /* 15. Code retrait + QR */
    .ticket .code-label { text-align: center; font-size: ${fs.small}px; text-transform: uppercase; letter-spacing: 1px; }
    .ticket .code { font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace; text-align: center; font-weight: 900; font-size: ${fs.huge}px; line-height: 1; letter-spacing: 6px; margin: 2px 0; }
    .ticket .qr-wrap { display: flex; justify-content: center; margin: 4px 0; }

    /* 16. Footer */
    .ticket .footer { text-align: center; font-size: ${fs.micro}px; margin-top: 6px; opacity: 0.9; }

    @media print {
      .ticket .banner, .ticket .copy-banner, .ticket .pay-final, .ticket .note-block { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
    }
  `;

  const html = `
<div class="ticket">
  ${copyBanner}

  <!-- 1. Header : logo + nom -->
  <div class="brand">
    ${coligoMark(logoSize)}
    <span class="name">${escapeHtml(order.merchant_name)}</span>
  </div>

  <!-- 2. Bandeau noir inversé -->
  <div class="banner">${escapeHtml(bannerLabel)}</div>

  <!-- 3. #ID énorme -->
  <div class="order-id">#${escapeHtml(shortId(order.id))}</div>

  <!-- 4. Heure de retrait -->
  <div class="pickup-time-label">Retrait</div>
  <div class="pickup-time">${escapeHtml(formatTime(order.pickup_slot_at))}</div>

  <div class="dotted"></div>

  ${noteHtml}

  <!-- 8. Articles groupés par catégorie -->
  ${itemsHtml || '<div class="cat-group"><div class="cat-title">ARTICLES (0)</div></div>'}

  <div class="dotted"></div>

  <!-- 10. Récap à droite -->
  <table class="recap"><tbody>${recapRows.join("")}</tbody></table>

  ${paymentFooter}

  <div class="dotted"></div>

  <!-- 12. Soumis le -->
  <div class="meta"><span class="label">Soumis le</span><span>${escapeHtml(formatSubmitted(order.created_at))}</span></div>
  <!-- 13. Client -->
  <div class="meta"><span class="label">Client</span><span>${escapeHtml(order.customer_name)}</span></div>
  <div class="meta"><span class="label">Tél</span><span>${escapeHtml(order.customer_phone)}</span></div>

  <div class="dotted"></div>

  <!-- 15. Code retrait + QR -->
  <div class="code-label">Code de retrait</div>
  <div class="code">${escapeHtml(order.pickup_code)}</div>
  <div class="qr-wrap">${qr}</div>

  <!-- 16. Footer -->
  <div class="footer">
    Commande via ${escapeHtml(opts.appName ?? "Coligo")}<br/>
    Imprimé le ${escapeHtml(formatSubmitted(new Date().toISOString()))}
  </div>
</div>
<style>${styles}</style>
`;

  return { html, widthMm: w };
}
