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
import type { SunmiAlign, SunmiCommand } from "@/lib/native/sunmi-printer";

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

/** Ligne pointillée mineure plein-papier (32 ou 48 chars de '-'). */
function dottedLine(width: PrintWidth): string {
  return "-".repeat(columnsFor(width));
}

/** Ligne pleine plein-papier ('=' x N) — séparation MAJEURE entre sections. */
function heavyLine(width: PrintWidth): string {
  return "=".repeat(columnsFor(width));
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
  const dotted = dottedLine(opts.width); // -------- mineur
  const heavy = heavyLine(opts.width); // ======== majeur
  const cols = columnsFor(opts.width);

  const isPaidOnline =
    order.payment_method === "online" && order.payment_status === "paid";
  const isCash = order.payment_method === "cash";
  const bannerLabel = isPaidOnline
    ? "PAYE EN LIGNE"
    : isCash
      ? "A ENCAISSER"
      : "RETRAIT";

  // Helpers locaux pour rendre la séquence très lisible.
  const heavySep = () => {
    out.push({ type: "align", value: "left" });
    out.push({ type: "size", value: SZ.small });
    out.push({ type: "text", text: heavy });
  };
  const lightSep = () => {
    out.push({ type: "align", value: "left" });
    out.push({ type: "size", value: SZ.small });
    out.push({ type: "text", text: dotted });
  };

  // === COPIE (multi-exemplaires) ===
  if (opts.copyLabel) {
    out.push({ type: "align", value: "center" });
    out.push({ type: "size", value: SZ.small });
    out.push({ type: "textBold", text: opts.copyLabel });
  }

  // ===== HEADER : nom commerce =====
  heavySep();
  out.push({ type: "align", value: "center" });
  out.push({ type: "size", value: SZ.base });
  out.push({ type: "textBold", text: order.merchant_name });
  heavySep();

  // ===== BANDEAU MODE (RETRAIT / PAYE / A ENCAISSER) =====
  out.push({ type: "align", value: "center" });
  out.push({ type: "size", value: SZ.base });
  out.push({ type: "textInverse", text: centerPad(bannerLabel, opts.width) });
  heavySep();

  // ===== #ID + heure retrait (les 2 infos LES PLUS visibles) =====
  out.push({ type: "align", value: "center" });
  out.push({ type: "size", value: SZ.large });
  out.push({ type: "textBoldStrong", text: `#${shortId(order.id)}` });
  out.push({ type: "size", value: SZ.small });
  out.push({ type: "text", text: "RETRAIT A" });
  out.push({ type: "size", value: SZ.base });
  out.push({ type: "textBoldStrong", text: formatTime(order.pickup_slot_at) });
  heavySep();

  // ===== NOTE CLIENT (si présente, en encadré visible) =====
  if (order.notes && order.notes !== "seed") {
    out.push({ type: "align", value: "left" });
    out.push({ type: "size", value: SZ.base });
    out.push({ type: "textBold", text: "NOTE CLIENT :" });
    out.push({ type: "text", text: order.notes });
    heavySep();
  }

  // ===== ARTICLES groupés par catégorie =====
  out.push({ type: "align", value: "center" });
  out.push({ type: "size", value: SZ.base });
  out.push({ type: "textBold", text: "ARTICLES" });
  lightSep();
  out.push({ type: "align", value: "left" });
  out.push({ type: "size", value: SZ.base });
  const groups = groupByCategory(order.items);
  if (groups.length === 0) {
    out.push({ type: "text", text: "(aucun article)" });
  } else {
    const qtyW = 3;
    const priceW = 8;
    const nameW = cols - qtyW - priceW - 2; // -2 pour les espaces de garde
    for (let gi = 0; gi < groups.length; gi++) {
      const g = groups[gi];
      out.push({ type: "textBold", text: g.title.toUpperCase() });
      for (const it of g.items) {
        const qty = String(it.quantity).replace(/\.0+$/, "") + "x";
        out.push({
          type: "columns",
          cols: [qty, it.product_name, formatDA(it.line_total_da)],
          widths: [qtyW, nameW, priceW],
          aligns: ["left", "left", "right"],
        });
      }
      if (gi < groups.length - 1) lightSep();
    }
  }
  heavySep();

  // ===== RECAP financier =====
  const subtotal = order.items.reduce((s, it) => s + it.line_total_da, 0);
  const discount = Math.max(
    0,
    subtotal + order.service_fee_da - order.total_da
  );
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

  if (discount > 0 || order.service_fee_da > 0) {
    pushRecap("Sous-total", formatDA(subtotal));
  }
  if (order.service_fee_da > 0) {
    pushRecap("Frais service", formatDA(order.service_fee_da));
  }
  if (discount > 0) {
    pushRecap("Reduction", `-${formatDA(discount)}`);
  }
  if (order.cashback_da > 0) {
    pushRecap("Cashback", `-${formatDA(order.cashback_da)}`);
  }
  lightSep();

  // TOTAL en gros gras fort, centré
  out.push({ type: "align", value: "center" });
  out.push({ type: "size", value: SZ.base });
  out.push({
    type: "textBoldStrong",
    text: `TOTAL ${formatDA(order.total_da)}`,
  });

  // Bandeau paiement final (mirror du bandeau du haut, plus utilitaire)
  if (isPaidOnline) {
    out.push({ type: "align", value: "center" });
    out.push({ type: "size", value: SZ.small });
    out.push({ type: "textBold", text: "** PAYE EN LIGNE **" });
  } else if (isCash) {
    out.push({ type: "align", value: "center" });
    out.push({ type: "size", value: SZ.small });
    out.push({
      type: "textBold",
      text: `** A ENCAISSER : ${formatDA(order.total_da)} **`,
    });
  }
  heavySep();

  // ===== INFOS CLIENT =====
  out.push({ type: "align", value: "left" });
  out.push({ type: "size", value: SZ.small });
  const labW = Math.floor(cols * 0.28);
  const valW = cols - labW;
  out.push({
    type: "columns",
    cols: ["Soumis", formatSubmitted(order.created_at)],
    widths: [labW, valW],
    aligns: ["left", "right"],
  });
  out.push({
    type: "columns",
    cols: ["Client", order.customer_name],
    widths: [labW, valW],
    aligns: ["left", "right"],
  });
  out.push({
    type: "columns",
    cols: ["Tel", order.customer_phone],
    widths: [labW, valW],
    aligns: ["left", "right"],
  });
  heavySep();

  // ===== CODE RETRAIT (énorme) + QR (centré) =====
  out.push({ type: "align", value: "center" });
  out.push({ type: "size", value: SZ.small });
  out.push({ type: "text", text: "CODE DE RETRAIT" });
  out.push({ type: "size", value: SZ.large });
  out.push({ type: "textBoldStrong", text: order.pickup_code });
  // Force l'alignement avant le QR — sur Sunmi V3 setAlignment marche
  // pour printQRCode même si elle est ignorée pour printText (testé).
  out.push({ type: "align", value: "center" });
  out.push({
    type: "qr",
    data: order.pickup_code,
    moduleSize: opts.width === 80 ? 6 : 5,
    errorLevel: 3,
  });
  heavySep();

  // ===== FOOTER (compact) =====
  out.push({ type: "align", value: "center" });
  out.push({ type: "size", value: SZ.small });
  out.push({
    type: "text",
    text: `${opts.appName ?? "Coligo"}  ${formatSubmitted(new Date().toISOString())}`,
  });

  // Reset final
  out.push({ type: "align", value: "left" });

  // Pass de sanitization finale : applique `asciize` à toutes les chaînes
  // envoyées à l'imprimante (text, columns.cols). Le firmware Sunmi V3
  // ignore les printText contenant certains caractères non ASCII — on
  // garantit une sortie purement imprimable, peu importe d'où vient la
  // donnée (nom de produit, note client, …).
  const sanitized = out.map((cmd): SunmiCommand => {
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

  // Preview ASCII en console — visible dans logcat (chromium:I) avant que
  // le ticket parte à l'imprimante. Permet de vérifier le layout sans
  // gaspiller du papier.
  try {
    console.info("[ticket-preview]\n" + previewAscii(sanitized, cols));
  } catch {
    /* ignored */
  }

  return sanitized;
}

/**
 * Génère un rendu ASCII approximatif des commandes pour debug. Ne reproduit
 * pas exactement la taille des polices (cf. firmware), mais montre la
 * structure : alignements, contenu, séparateurs.
 */
function previewAscii(commands: SunmiCommand[], cols: number): string {
  const lines: string[] = [];
  let align: SunmiAlign = "left";
  const pad = (txt: string, a: SunmiAlign) => {
    if (txt.length >= cols) return txt;
    const space = cols - txt.length;
    if (a === "center") {
      const l = Math.floor(space / 2);
      return " ".repeat(l) + txt + " ".repeat(space - l);
    }
    if (a === "right") return " ".repeat(space) + txt;
    return txt;
  };
  for (const cmd of commands) {
    switch (cmd.type) {
      case "align":
        align = cmd.value;
        break;
      case "text":
        lines.push(pad(cmd.text, align));
        break;
      case "textBold":
        lines.push(pad("*" + cmd.text + "*", align));
        break;
      case "textBoldStrong":
        lines.push(pad("**" + cmd.text + "**", align));
        break;
      case "textInverse":
        lines.push(pad("[" + cmd.text.trim() + "]", align));
        break;
      case "columns": {
        const total = cmd.widths.reduce((a, b) => a + b, 0);
        let line = "";
        for (let i = 0; i < cmd.cols.length; i++) {
          const w = Math.round((cmd.widths[i] / total) * cols);
          const a = cmd.aligns?.[i] ?? "left";
          const t = cmd.cols[i] ?? "";
          const truncated = t.length > w ? t.slice(0, w) : t;
          line += pad(truncated, a).slice(0, w);
        }
        lines.push(line);
        break;
      }
      case "qr":
        lines.push(pad("[QR " + cmd.data + "]", align));
        break;
      case "wrap":
        for (let i = 0; i < cmd.n; i++) lines.push("");
        break;
      case "cut":
        lines.push("--- cut ---");
        break;
      default:
        break;
    }
  }
  return lines.join("\n");
}
