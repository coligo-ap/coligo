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

// Tailles texte (en pixels sur l'imprimante). Le plugin Java les snap au
// set autorisé par le firmware V3 ({16, 24, 28, 32, 48}) — on choisit ici
// directement des valeurs déjà compatibles pour éviter les surprises.
//
// Design compact : ne pas multiplier les tailles, jouer sur le bold/strong
// plutôt que sur la taille pour la hiérarchie. Le `textBoldStrong` rend
// l'effet d'un texte « énorme » sans changer la taille (double-width via
// ESC ! côté plugin).
const SZ = {
  small: 16,
  base: 24,
  large: 32,
};

/**
 * Réduit un texte à de l'ASCII imprimable. Le firmware Sunmi V3 ignore
 * silencieusement des `printText` qui contiennent certains caractères non
 * ASCII (em-dash «—», quotes typographiques, accents combinés…). On
 * normalise NFD + on retire les diacritiques + on remplace les ponctuations
 * exotiques par leur équivalent ASCII.
 */
function asciize(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // accents combinés
    .replace(/[‐-―]/g, "-") // dashes (em, en, figure, horizontal bar)
    .replace(/[‘’‚‛′]/g, "'") // single quotes
    .replace(/[“”„‟″]/g, '"') // double quotes
    .replace(/…/g, "...") // ellipsis
    .replace(/·|•|●/g, "-") // middle dot, bullet, black circle
    .replace(/ /g, " ") // non-breaking space
    .replace(/[^\x20-\x7E\n]/g, ""); // garde printable ASCII + newline
}

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
  }

  // --- 1. Header : nom commerce, taille base + bold ---
  out.push({ type: "align", value: "center" });
  out.push({ type: "size", value: SZ.base });
  out.push({ type: "textBold", text: order.merchant_name });

  // --- 2. Bandeau noir inversé (mode dominant) ---
  out.push({ type: "textInverse", text: centerPad(bannerLabel, opts.width) });

  // --- 3. #ID — double width + bold + size large (très visible) ---
  out.push({ type: "size", value: SZ.large });
  out.push({ type: "textBoldStrong", text: `#${shortId(order.id)}` });

  // --- 4. Heure de retrait — RETRAIT label small + heure boldStrong ---
  out.push({ type: "size", value: SZ.small });
  out.push({ type: "text", text: "RETRAIT" });
  out.push({ type: "size", value: SZ.base });
  out.push({ type: "textBoldStrong", text: formatTime(order.pickup_slot_at) });

  // --- Séparateur ---
  out.push({ type: "align", value: "left" });
  out.push({ type: "size", value: SZ.small });
  out.push({ type: "text", text: dotted });

  // --- 6. Note client (encadrée) ---
  if (order.notes && order.notes !== "seed") {
    out.push({ type: "textBold", text: "NOTE CLIENT" });
    out.push({ type: "text", text: order.notes });
    out.push({ type: "text", text: dotted });
  }

  // --- 8. Articles par catégorie (compact, base size) ---
  out.push({ type: "size", value: SZ.base });
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

  out.push({ type: "size", value: SZ.small });
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

  out.push({ type: "size", value: SZ.base });
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

  // Total en GRAS FORT (double-width) — la ligne la plus visible du récap.
  out.push({
    type: "columns",
    cols: ["", ""],
    widths: [1, 1],
    aligns: ["left", "left"],
  });
  out.push({ type: "size", value: SZ.base });
  // textBoldStrong sur 1 colonne pleine largeur, alignée à droite
  out.push({ type: "align", value: "right" });
  out.push({
    type: "textBoldStrong",
    text: `TOTAL ${formatDA(order.total_da)}`,
  });

  // --- 11. Repère paiement final ---
  if (isPaidOnline) {
    out.push({ type: "align", value: "center" });
    out.push({ type: "size", value: SZ.base });
    out.push({ type: "textBold", text: "PAYE EN LIGNE" });
  } else if (isCash) {
    out.push({ type: "align", value: "center" });
    out.push({ type: "size", value: SZ.base });
    out.push({
      type: "textBold",
      text: `A ENCAISSER ${formatDA(order.total_da)}`,
    });
  }

  out.push({ type: "align", value: "left" });
  out.push({ type: "size", value: SZ.small });
  out.push({ type: "text", text: dotted });

  // --- 12-13. Soumis le / Client / Tél (compact small) ---
  out.push({
    type: "columns",
    cols: ["Soumis", formatSubmitted(order.created_at)],
    widths: [Math.floor(cols * 0.3), Math.ceil(cols * 0.7)],
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

  // --- 15. Code retrait + QR (compact) ---
  out.push({ type: "align", value: "center" });
  out.push({ type: "size", value: SZ.small });
  out.push({ type: "text", text: "CODE DE RETRAIT" });
  out.push({ type: "size", value: SZ.large });
  out.push({ type: "textBoldStrong", text: order.pickup_code });
  out.push({
    type: "qr",
    data: order.pickup_code,
    moduleSize: opts.width === 80 ? 6 : 5,
    errorLevel: 3,
  });

  // --- 16. Footer (size small, peu intrusif) ---
  out.push({ type: "size", value: SZ.small });
  out.push({
    type: "text",
    text: `${opts.appName ?? "Coligo"} - ${formatSubmitted(new Date().toISOString())}`,
  });

  // Reset alignement final pour le prochain ticket.
  out.push({ type: "align", value: "left" });

  // Pass de sanitization finale : applique `asciize` à toutes les chaînes
  // envoyées à l'imprimante (text, columns.cols). Le firmware Sunmi V3
  // ignore les printText contenant certains caractères non ASCII — on
  // garantit une sortie purement imprimable, peu importe d'où vient la
  // donnée (nom de produit, note client, …).
  return out.map((cmd): SunmiCommand => {
    switch (cmd.type) {
      case "text":
      case "textBold":
      case "textBoldStrong":
      case "textInverse":
        return { ...cmd, text: asciize(cmd.text) };
      case "columns":
        return { ...cmd, cols: cmd.cols.map(asciize) };
      default:
        return cmd;
    }
  });
}
