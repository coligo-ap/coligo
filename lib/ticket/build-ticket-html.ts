/**
 * Construit le HTML du ticket d'une commande, prêt à être imprimé par
 * `lib/native/printer.ts` (window.print() aujourd'hui, SDK Sunmi demain).
 *
 * Contrainte thermique : noir et blanc uniquement, contrastes forts, pas
 * d'images lourdes. Le QR du code de retrait est généré inline en SVG via
 * `@zxing/library` (déjà installé pour le scanner) — aucune dépendance
 * supplémentaire.
 *
 * NB : `printTicket()` injecte déjà `@page { size: <width>mm auto }` et un
 * `body { width: <width>mm; padding: 4mm; font: monospace }`. On ne re-déclare
 * QUE ce qui est spécifique au ticket pour éviter les conflits.
 */

import type { PrintWidth } from "@/lib/types";

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
  items: Array<{
    product_name: string;
    quantity: number;
    unit_price_da: number;
    line_total_da: number;
  }>;
};

export type BuildTicketOptions = {
  width: PrintWidth;
  /** Footer override (par défaut « Commande via Coligo »). */
  appName?: string;
  /** Mention « COPIE 2/3 » sur les multi-exemplaires. */
  copyLabel?: string;
};

export type BuiltTicket = {
  /** Fragment HTML (contenu de <body>), avec ses propres <style>. */
  html: string;
  /** Largeur mm à passer à `printTicket()`. */
  widthMm: PrintWidth;
};

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

function formatDateTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("fr-DZ", {
    day: "2-digit",
    month: "2-digit",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function formatTime(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleTimeString("fr-DZ", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

function shortId(id: string): string {
  return id.slice(0, 6).toUpperCase();
}

/**
 * Encode un texte en QR (BitMatrix via @zxing/library) puis renvoie un SVG
 * pur N&B. Import dynamique pour ne pas alourdir le bundle des écrans qui
 * n'impriment pas.
 */
async function qrSvg(text: string, sizePx: number): Promise<string> {
  const { QRCodeWriter, BarcodeFormat, EncodeHintType } =
    await import("@zxing/library");
  const writer = new QRCodeWriter();
  // Marge interne (quiet zone) gérée par le viewBox : on demande 0 ici.
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
      if (matrix.get(x, y)) {
        path += `M${x},${y}h1v1h-1z`;
      }
    }
  }
  // viewBox = grille brute ; on impose la taille via width/height.
  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${w} ${h}" width="${sizePx}" height="${sizePx}" shape-rendering="crispEdges"><rect width="100%" height="100%" fill="#fff"/><path d="${path}" fill="#000"/></svg>`;
}

export async function buildTicketHTML(
  order: TicketOrder,
  opts: BuildTicketOptions
): Promise<BuiltTicket> {
  const w = opts.width;
  const isWide = w === 80;
  // Tailles adaptées : plus large = un peu plus grand sans excès.
  const fs = {
    base: isWide ? 13 : 11,
    small: isWide ? 11 : 9,
    h1: isWide ? 16 : 14,
    h2: isWide ? 22 : 18,
    huge: isWide ? 30 : 24,
  };
  const qrSize = isWide ? 180 : 140;

  const isPaidOnline =
    order.payment_method === "online" && order.payment_status === "paid";
  const isCash = order.payment_method === "cash";

  const subtotal = order.items.reduce((s, it) => s + it.line_total_da, 0);

  const itemsHtml = order.items
    .map((it) => {
      const qty = String(it.quantity).replace(/\.0+$/, "");
      const line = `${qty} × ${escapeHtml(it.product_name)}`;
      return `
        <div class="row">
          <div class="row-label">${line}</div>
          <div class="row-value">${escapeHtml(formatDA(it.line_total_da))}</div>
        </div>
        <div class="row sub">
          <div class="row-label">  ${escapeHtml(formatDA(it.unit_price_da))} l'unité</div>
          <div></div>
        </div>`;
    })
    .join("");

  const paymentBlock = isPaidOnline
    ? `<div class="payment paid">&#10003; PAYÉ EN LIGNE</div>`
    : isCash
      ? `<div class="payment cash">
           <div class="cash-label">À ENCAISSER</div>
           <div class="cash-amount">${escapeHtml(formatDA(order.total_da))}</div>
         </div>`
      : `<div class="payment pending">PAIEMENT EN ATTENTE</div>`;

  const copyBanner = opts.copyLabel
    ? `<div class="copy-banner">${escapeHtml(opts.copyLabel)}</div>`
    : "";

  const notesBlock =
    order.notes && order.notes !== "seed"
      ? `<div class="sep"></div>
         <div class="notes-label">NOTE DU CLIENT</div>
         <div class="notes">${escapeHtml(order.notes)}</div>`
      : "";

  const recapRows: string[] = [];
  if (subtotal !== order.total_da || order.service_fee_da > 0) {
    recapRows.push(
      `<div class="row"><div>Sous-total</div><div>${escapeHtml(formatDA(subtotal))}</div></div>`
    );
  }
  if (order.service_fee_da > 0) {
    recapRows.push(
      `<div class="row"><div>Frais de service</div><div>${escapeHtml(formatDA(order.service_fee_da))}</div></div>`
    );
  }
  if (order.cashback_da > 0) {
    recapRows.push(
      `<div class="row"><div>Cashback</div><div>-${escapeHtml(formatDA(order.cashback_da))}</div></div>`
    );
  }

  const qr = await qrSvg(order.pickup_code, qrSize);

  // Tout est en monochrome et avec des unités relatives → s'imprime
  // identiquement sur 58 / 80 mm en jouant uniquement sur les font-size.
  const styles = `
    .ticket { font-family: ui-monospace, "SFMono-Regular", Menlo, Consolas, monospace; color: #000; font-size: ${fs.base}px; line-height: 1.35; }
    .ticket .center { text-align: center; }
    .ticket .bold { font-weight: 700; }
    .ticket .small { font-size: ${fs.small}px; }
    .ticket .sep { border-top: 1px dashed #000; margin: 4px 0; }
    .ticket .merchant { font-size: ${fs.h2}px; font-weight: 800; text-align: center; letter-spacing: 0.5px; }
    .ticket .order-id { font-size: ${fs.h1}px; font-weight: 700; text-align: center; margin-top: 2px; }
    .ticket .pickup-time-label { text-align: center; font-size: ${fs.small}px; margin-top: 4px; text-transform: uppercase; letter-spacing: 1px; }
    .ticket .pickup-time { text-align: center; font-size: ${fs.huge}px; font-weight: 900; line-height: 1; margin: 2px 0; }
    .ticket .payment { text-align: center; font-weight: 800; font-size: ${fs.h1}px; padding: 4px 0; border: 2px solid #000; margin: 2px 0; }
    .ticket .payment.cash { padding: 6px 0; }
    .ticket .payment .cash-label { font-size: ${fs.small}px; font-weight: 700; letter-spacing: 1px; }
    .ticket .payment .cash-amount { font-size: ${fs.h2}px; font-weight: 900; }
    .ticket .row { display: flex; justify-content: space-between; gap: 6px; }
    .ticket .row .row-label { flex: 1; word-break: break-word; }
    .ticket .row .row-value { white-space: nowrap; }
    .ticket .row.sub { color: #000; font-size: ${fs.small}px; }
    .ticket .section-label { text-transform: uppercase; letter-spacing: 1px; font-weight: 700; font-size: ${fs.small}px; margin: 2px 0; }
    .ticket .total { display: flex; justify-content: space-between; font-weight: 900; font-size: ${fs.h1}px; padding-top: 2px; }
    .ticket .pickup-code-label { text-align: center; font-size: ${fs.small}px; text-transform: uppercase; letter-spacing: 1px; margin-top: 4px; }
    .ticket .pickup-code { text-align: center; font-size: ${fs.huge}px; font-weight: 900; letter-spacing: 6px; margin: 2px 0; }
    .ticket .qr-wrap { display: flex; justify-content: center; margin: 4px 0; }
    .ticket .notes-label { font-size: ${fs.small}px; text-transform: uppercase; letter-spacing: 1px; font-weight: 700; }
    .ticket .notes { padding: 2px 4px; border: 1px solid #000; font-size: ${fs.small}px; }
    .ticket .footer { text-align: center; font-size: ${fs.small}px; margin-top: 6px; }
    .ticket .copy-banner { text-align: center; font-weight: 800; font-size: ${fs.small}px; padding: 2px 0; border: 1px solid #000; margin-bottom: 4px; letter-spacing: 2px; }
    @media print {
      .ticket { color: #000 !important; }
      .ticket * { background: transparent !important; }
    }
  `;

  const html = `
<div class="ticket">
  ${copyBanner}
  <div class="merchant">${escapeHtml(order.merchant_name)}</div>
  <div class="sep"></div>
  <div class="order-id">#${escapeHtml(shortId(order.id))}</div>
  <div class="pickup-time-label">Heure de retrait</div>
  <div class="pickup-time">${escapeHtml(formatTime(order.pickup_slot_at))}</div>
  <div class="sep"></div>
  ${paymentBlock}
  <div class="sep"></div>
  <div class="row"><div>Client</div><div class="bold">${escapeHtml(order.customer_name)}</div></div>
  <div class="row"><div>Téléphone</div><div>${escapeHtml(order.customer_phone)}</div></div>
  <div class="row small"><div>Commandée le</div><div>${escapeHtml(formatDateTime(order.created_at))}</div></div>
  <div class="sep"></div>
  <div class="section-label">Articles</div>
  ${itemsHtml || '<div class="small">— Aucun article —</div>'}
  <div class="sep"></div>
  ${recapRows.join("")}
  <div class="total"><div>TOTAL</div><div>${escapeHtml(formatDA(order.total_da))}</div></div>
  <div class="sep"></div>
  <div class="pickup-code-label">Code de retrait</div>
  <div class="pickup-code">${escapeHtml(order.pickup_code)}</div>
  <div class="qr-wrap">${qr}</div>
  ${notesBlock}
  <div class="sep"></div>
  <div class="footer">Commande via ${escapeHtml(opts.appName ?? "Coligo")}<br/>Imprimé le ${escapeHtml(formatDateTime(new Date().toISOString()))}</div>
</div>
<style>${styles}</style>
`;

  return { html, widthMm: w };
}
