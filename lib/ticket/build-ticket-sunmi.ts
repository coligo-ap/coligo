/**
 * Builder « commandes Sunmi » du ticket de commande — reproduit la même
 * hiérarchie visuelle que `buildTicketHTML()` mais via le SDK Sunmi (AIDL
 * woyou.aidlservice.jiuiv5), pour impression DIRECTE sans dialogue.
 *
 * On vise une parité visuelle avec le ticket HTML :
 *   - bandeau noir inversé (mode dominant : RETRAIT / PAYÉ / À ENCAISSER)
 *   - #ID énorme + heure de retrait grosse
 *   - articles regroupés par catégorie
 *   - récap aligné à droite via `printColumnsText`
 *   - QR code natif imprimante (matrice ESC/POS, pas une image bitmap)
 *   - coupe papier finale
 *
 * Largeur :
 *   - 58 mm  → 32 colonnes (font 24px)
 *   - 80 mm  → 48 colonnes (font 24px)
 */

import type { TicketItem, TicketOrder } from "@/lib/ticket/build-ticket-html";
import type { PrintWidth } from "@/lib/types";
import type { SunmiCommand } from "@/lib/native/sunmi-printer";

export type BuildSunmiOptions = {
  width: PrintWidth;
  appName?: string;
  copyLabel?: string;
};

// Tailles texte (en pixels sur l'imprimante).
const SZ = {
  micro: 18,
  small: 21,
  base: 24,
  medium: 30,
  large: 36,
  huge: 56,
};

// Colonnes utilisables par largeur de papier (font base = 24).
function columnsFor(width: PrintWidth): number {
  return width === 80 ? 48 : 32;
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

function totalUnits(items: TicketItem[]): number {
  return items.reduce((s, it) => s + Number(it.quantity || 0), 0);
}

function groupByCategory(
  items: TicketItem[]
): Array<{ title: string; items: TicketItem[] }> {
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

/** Ligne pointillée plein-papier (32 ou 48 chars de '-'). */
function dottedLine(width: PrintWidth): string {
  return "-".repeat(columnsFor(width));
}

/** Pad un texte sur N colonnes pour le bandeau inversé full-width. */
function centerPad(text: string, width: PrintWidth): string {
  const cols = columnsFor(width);
  const t = text.length > cols ? text.slice(0, cols) : text;
  const left = Math.max(0, Math.floor((cols - t.length) / 2));
  const right = Math.max(0, cols - t.length - left);
  return " ".repeat(left) + t + " ".repeat(right);
}

export function buildTicketSunmiCommands(
  order: TicketOrder,
  opts: BuildSunmiOptions
): SunmiCommand[] {
  const out: SunmiCommand[] = [];
  const dotted = dottedLine(opts.width);
  const cols = columnsFor(opts.width);

  const isPaidOnline =
    order.payment_method === "online" && order.payment_status === "paid";
  const isCash = order.payment_method === "cash";
  const bannerLabel = isPaidOnline
    ? "PAYE EN LIGNE"
    : isCash
      ? "A ENCAISSER"
      : "RETRAIT";

  // --- Copy banner (si multi-exemplaire) ---
  if (opts.copyLabel) {
    out.push({ type: "align", value: "center" });
    out.push({ type: "size", value: SZ.small });
    out.push({ type: "textBold", text: opts.copyLabel });
    out.push({ type: "wrap", n: 1 });
  }

  // --- 1. Header : logo "●" + nom du commerce ---
  out.push({ type: "align", value: "center" });
  out.push({ type: "size", value: SZ.base });
  out.push({ type: "textBold", text: order.merchant_name });

  // --- 2. Bandeau noir inversé ---
  out.push({ type: "size", value: SZ.medium });
  out.push({ type: "textInverse", text: centerPad(bannerLabel, opts.width) });
  out.push({ type: "wrap", n: 1 });

  // --- 3. #ID énorme ---
  out.push({ type: "size", value: SZ.huge });
  out.push({ type: "textBold", text: `#${shortId(order.id)}` });

  // --- 4. Heure de retrait ---
  out.push({ type: "size", value: SZ.small });
  out.push({ type: "text", text: "RETRAIT" });
  out.push({ type: "size", value: SZ.large });
  out.push({ type: "textBold", text: formatTime(order.pickup_slot_at) });
  out.push({ type: "wrap", n: 1 });

  // --- Séparateur ---
  out.push({ type: "align", value: "left" });
  out.push({ type: "size", value: SZ.base });
  out.push({ type: "text", text: dotted });

  // --- 6. Note client (encadrée) ---
  if (order.notes && order.notes !== "seed") {
    out.push({ type: "textBold", text: "NOTE CLIENT" });
    out.push({ type: "text", text: order.notes });
    out.push({ type: "text", text: dotted });
  }

  // --- 8. Articles par catégorie ---
  const groups = groupByCategory(order.items);
  if (groups.length === 0) {
    out.push({ type: "textBold", text: "ARTICLES (0)" });
  } else {
    for (const g of groups) {
      const count = g.items.reduce((s, it) => s + Number(it.quantity || 0), 0);
      out.push({
        type: "textBold",
        text: `${g.title.toUpperCase()} (${String(count).replace(/\.0+$/, "")})`,
      });
      for (const it of g.items) {
        const qty = String(it.quantity).replace(/\.0+$/, "");
        out.push({ type: "text", text: `${qty}x ${it.product_name}` });
      }
    }
  }

  out.push({ type: "text", text: dotted });

  // --- 10. Récap aligné droite ---
  const subtotal = order.items.reduce((s, it) => s + it.line_total_da, 0);
  const discount = Math.max(
    0,
    subtotal + order.service_fee_da - order.total_da
  );
  const units = totalUnits(order.items);

  const labelWidth = Math.floor(cols * 0.6);
  const valueWidth = cols - labelWidth;

  const pushRecap = (label: string, value: string) => {
    out.push({
      type: "columns",
      cols: [label, value],
      widths: [labelWidth, valueWidth],
      aligns: ["left", "right"],
    });
  };

  pushRecap("Nb d'articles", String(units).replace(/\.0+$/, ""));
  if (discount > 0 || order.service_fee_da > 0) {
    pushRecap("Sous-total", formatDA(subtotal));
  }
  if (order.service_fee_da > 0) {
    pushRecap("Frais de service", formatDA(order.service_fee_da));
  }
  if (discount > 0) {
    pushRecap("Reduction", `-${formatDA(discount)}`);
  }
  if (order.cashback_da > 0) {
    pushRecap("Cashback", `-${formatDA(order.cashback_da)}`);
  }
  // Total en grand
  out.push({ type: "size", value: SZ.medium });
  out.push({
    type: "columns",
    cols: ["TOTAL", formatDA(order.total_da)],
    widths: [labelWidth, valueWidth],
    aligns: ["left", "right"],
  });

  // --- 11. Repère paiement final ---
  if (isPaidOnline) {
    out.push({ type: "align", value: "center" });
    out.push({ type: "size", value: SZ.medium });
    out.push({ type: "textBold", text: "PAYE EN LIGNE" });
  } else if (isCash) {
    out.push({ type: "align", value: "center" });
    out.push({ type: "size", value: SZ.medium });
    out.push({
      type: "textBold",
      text: `A ENCAISSER : ${formatDA(order.total_da)}`,
    });
  }

  out.push({ type: "align", value: "left" });
  out.push({ type: "size", value: SZ.base });
  out.push({ type: "text", text: dotted });

  // --- 12-13. Soumis le / Client / Tél ---
  out.push({
    type: "columns",
    cols: ["Soumis le", formatSubmitted(order.created_at)],
    widths: [Math.floor(cols * 0.4), Math.ceil(cols * 0.6)],
    aligns: ["left", "right"],
  });
  out.push({
    type: "columns",
    cols: ["Client", order.customer_name],
    widths: [Math.floor(cols * 0.3), Math.ceil(cols * 0.7)],
    aligns: ["left", "right"],
  });
  out.push({
    type: "columns",
    cols: ["Tel", order.customer_phone],
    widths: [Math.floor(cols * 0.3), Math.ceil(cols * 0.7)],
    aligns: ["left", "right"],
  });

  out.push({ type: "text", text: dotted });

  // --- 15. Code retrait + QR ---
  out.push({ type: "align", value: "center" });
  out.push({ type: "size", value: SZ.small });
  out.push({ type: "text", text: "CODE DE RETRAIT" });
  out.push({ type: "size", value: SZ.huge });
  out.push({ type: "textBold", text: order.pickup_code });
  out.push({ type: "wrap", n: 1 });
  out.push({
    type: "qr",
    data: order.pickup_code,
    moduleSize: opts.width === 80 ? 8 : 6,
    errorLevel: 3,
  });

  // --- 16. Footer ---
  out.push({ type: "size", value: SZ.micro });
  out.push({
    type: "text",
    text: `Commande via ${opts.appName ?? "Coligo"}`,
  });
  out.push({
    type: "text",
    text: `Imprime le ${formatSubmitted(new Date().toISOString())}`,
  });

  // Reset alignement final pour le prochain ticket.
  out.push({ type: "align", value: "left" });

  return out;
}
