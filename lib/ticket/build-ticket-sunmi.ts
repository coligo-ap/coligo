/**
 * Builder « commandes Sunmi » du ticket — parité visuelle avec le ticket
 * HTML (cf. `maquette-ticket-80mm.html`), via le SDK Sunmi AIDL pour
 * impression directe sans dialogue navigateur.
 *
 * Structure suivie (identique à la maquette) :
 *   1. nom commerce centré gras + localité
 *   2. bandeau noir inversé "RETRAIT"
 *   3. #ID énorme (textBoldStrong → double-width)
 *   4. "RETRAIT À HH:MM" en gros
 *   5. méta : Commandé le / Client / Tél (colonnes label/valeur)
 *   6. badge "NOUVEAU CLIENT" optionnel
 *   7. articles groupés par catégorie : "— CATEGORIE (N) —" + lignes
 *      `qty× nom ........ prix DA`
 *   8. récap aligné à droite (sous-total, frais, réduction)
 *   9. TOTAL en gras fort
 *  10. bloc paiement (À ENCAISSER : X DA / PAYÉ EN LIGNE)
 *  11. CODE DE RETRAIT + 6 chiffres espacés en gros + QR
 *  12. footer (Commande via Coligo + horodatage)
 *
 * Largeur :
 *   - 80 mm → 48 colonnes (cible Sunmi V3)
 *   - 58 mm → 32 colonnes (legacy / imprimantes tierces)
 */

import type { TicketItem, TicketOrder } from "@/lib/ticket/build-ticket-html";
import type { PrintWidth } from "@/lib/types";
import type { SunmiAlign, SunmiCommand } from "@/lib/native/sunmi-printer";

export type BuildSunmiOptions = {
  width: PrintWidth;
  appName?: string;
  copyLabel?: string;
};

// Tailles texte (firmware V3 = {16, 24, 28, 32, 48}). On en utilise 3 :
//   small = méta, recap, footer
//   base  = corps du ticket (items, rows, banner, pay)
//   large = #ID, code de retrait, heure de retrait
const SZ = {
  small: 16,
  base: 24,
  large: 32,
};

/**
 * Sanitise un texte vers de l'ASCII imprimable. Le firmware Sunmi V3 ignore
 * silencieusement certains caractères non ASCII (em-dash, quotes typo,
 * accents combinés). On normalise NFD + on retire diacritiques + on
 * remplace les ponctuations exotiques.
 */
function asciize(input: string): string {
  return input
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "") // accents combinés
    .replace(/[‐-―]/g, "-") // tous dashes → -
    .replace(/[‘’‚‛′]/g, "'")
    .replace(/[“”„‟″]/g, '"')
    .replace(/…/g, "...")
    .replace(/[·•●]/g, "-")
    .replace(/×/g, "x")
    .replace(/✓/g, "[OK]")
    .replace(/★/g, "*")
    .replace(/ /g, " ") // NBSP
    .replace(/[^\x20-\x7E\n]/g, "");
}

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

function formatShortDateTime(iso: string): string {
  const d = new Date(iso);
  const date = d.toLocaleDateString("fr-DZ", {
    day: "2-digit",
    month: "2-digit",
  });
  const time = d.toLocaleTimeString("fr-DZ", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `${date} ${time}`;
}

function shortId(id: string): string {
  return id.slice(0, 6).toUpperCase();
}

function groupCount(items: TicketItem[]): number {
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

function spaceOut(s: string): string {
  return s.split("").join(" ");
}

/** Centre un texte sur N colonnes (pour bandeau inversé full-width). */
function centerPad(text: string, cols: number): string {
  const t = text.length > cols ? text.slice(0, cols) : text;
  const left = Math.max(0, Math.floor((cols - t.length) / 2));
  const right = Math.max(0, cols - t.length - left);
  return " ".repeat(left) + t + " ".repeat(right);
}

/** Séparateur pointillé plein-papier (maquette : hr dashed). */
function dottedLine(cols: number): string {
  return "-".repeat(cols);
}

/** Séparateur plein (cf. divider-solid de la maquette). */
function solidLine(cols: number): string {
  return "=".repeat(cols);
}

export function buildTicketSunmiCommands(
  order: TicketOrder,
  opts: BuildSunmiOptions
): SunmiCommand[] {
  const out: SunmiCommand[] = [];
  const cols = columnsFor(opts.width);
  const isPaidOnline =
    order.payment_method === "online" && order.payment_status === "paid";
  const isCash = order.payment_method === "cash";

  // Config imprimante en TÊTE de séquence (largeur + interligne mini).
  out.push({ type: "paper", columns: cols });
  out.push({ type: "lineSpacing", dots: 0 });

  const divider = () => {
    out.push({ type: "align", value: "left" });
    out.push({ type: "size", value: SZ.base });
    out.push({ type: "text", text: dottedLine(cols) });
  };

  // === COPIE k/N ===
  if (opts.copyLabel) {
    out.push({ type: "align", value: "center" });
    out.push({ type: "size", value: SZ.small });
    out.push({ type: "textBold", text: opts.copyLabel });
  }

  // ===== 1. EN-TÊTE : nom commerce + localité =====
  out.push({ type: "align", value: "center" });
  out.push({ type: "size", value: SZ.base });
  out.push({ type: "textBold", text: order.merchant_name });
  if (order.merchant_locality) {
    out.push({ type: "size", value: SZ.small });
    out.push({ type: "text", text: order.merchant_locality });
  }

  // ===== 2. BANDEAU NOIR INVERSÉ "RETRAIT" =====
  out.push({ type: "size", value: SZ.base });
  out.push({ type: "textInverse", text: centerPad("RETRAIT", cols) });

  // ===== 3. #ID ÉNORME (textBoldStrong = double-width) =====
  out.push({ type: "align", value: "center" });
  out.push({ type: "size", value: SZ.large });
  out.push({ type: "textBoldStrong", text: `#${shortId(order.id)}` });

  // ===== 4. HEURE DE RETRAIT =====
  out.push({ type: "size", value: SZ.small });
  out.push({ type: "text", text: "RETRAIT A" });
  out.push({ type: "size", value: SZ.large });
  out.push({ type: "textBoldStrong", text: formatTime(order.pickup_slot_at) });

  divider();

  // ===== 5. MÉTA (Commandé le / Client / Tél) =====
  out.push({ type: "align", value: "left" });
  out.push({ type: "size", value: SZ.base });
  const labW = Math.floor(cols * 0.4);
  const valW = cols - labW;
  const metaRow = (l: string, r: string) => {
    out.push({
      type: "columns",
      cols: [l, r],
      widths: [labW, valW],
      aligns: ["left", "right"],
    });
  };
  metaRow("Commande le", formatShortDateTime(order.created_at));
  metaRow("Client", order.customer_name);
  metaRow("Tel", order.customer_phone);

  // ===== 6. BADGE NOUVEAU CLIENT =====
  if (order.is_new_customer) {
    out.push({ type: "align", value: "center" });
    out.push({ type: "size", value: SZ.base });
    out.push({ type: "textBold", text: "* NOUVEAU CLIENT *" });
  }

  divider();

  // ===== 7. ARTICLES groupés par catégorie =====
  out.push({ type: "align", value: "left" });
  out.push({ type: "size", value: SZ.base });
  const groups = groupByCategory(order.items);
  if (groups.length === 0) {
    out.push({ type: "text", text: "(aucun article)" });
  } else {
    const qtyW = 4;
    const priceW = 9;
    const nameW = cols - qtyW - priceW - 2;
    for (const g of groups) {
      out.push({
        type: "align",
        value: "center",
      });
      out.push({
        type: "textBold",
        text: `- ${g.title.toUpperCase()} (${groupCount(g.items)}) -`,
      });
      out.push({ type: "align", value: "left" });
      for (const it of g.items) {
        const qty = String(it.quantity).replace(/\.0+$/, "") + "x";
        out.push({
          type: "columns",
          cols: [qty, it.product_name, formatDA(it.line_total_da)],
          widths: [qtyW, nameW, priceW],
          aligns: ["left", "left", "right"],
        });
      }
    }
  }

  // Note client : si présente, l'ajouter en italique-ish (textBold faute de
  // mieux) sous les articles, avec préfixe ↳ (asciize → ->).
  if (order.notes && order.notes !== "seed") {
    out.push({ type: "size", value: SZ.small });
    out.push({ type: "text", text: `-> ${order.notes}` });
  }

  divider();

  // ===== 8. RÉCAP aligné à droite =====
  const subtotal = order.items.reduce((s, it) => s + it.line_total_da, 0);
  const discount = Math.max(
    0,
    subtotal + order.service_fee_da - order.total_da
  );
  const recapLabW = Math.floor(cols * 0.55);
  const recapValW = cols - recapLabW;
  const pushRecap = (label: string, value: string) => {
    out.push({
      type: "columns",
      cols: [label, value],
      widths: [recapLabW, recapValW],
      aligns: ["left", "right"],
    });
  };
  out.push({ type: "align", value: "left" });
  out.push({ type: "size", value: SZ.base });
  if (discount > 0 || order.service_fee_da > 0 || order.cashback_da > 0) {
    pushRecap("Sous-total", formatDA(subtotal));
  }
  if (order.service_fee_da > 0) {
    pushRecap("Frais service", formatDA(order.service_fee_da));
  }
  if (discount > 0) {
    const pct = subtotal > 0 ? Math.round((discount / subtotal) * 100) : 0;
    pushRecap(
      pct > 0 ? `Reduction -${pct}%` : "Reduction",
      `-${formatDA(discount)}`
    );
  }
  if (order.cashback_da > 0) {
    pushRecap("Cashback", `-${formatDA(order.cashback_da)}`);
  }

  // ===== 9. TOTAL en gras fort =====
  out.push({ type: "size", value: SZ.large });
  out.push({
    type: "columns",
    cols: ["TOTAL", formatDA(order.total_da)],
    widths: [Math.floor(cols * 0.4), Math.ceil(cols * 0.6)],
    aligns: ["left", "right"],
  });

  // ===== 10. BLOC PAIEMENT encadré (text + lignes solides) =====
  out.push({ type: "align", value: "left" });
  out.push({ type: "size", value: SZ.base });
  out.push({ type: "text", text: solidLine(cols) });
  out.push({ type: "align", value: "center" });
  if (isPaidOnline) {
    out.push({ type: "textBold", text: "[OK] PAYE EN LIGNE" });
    out.push({ type: "size", value: SZ.small });
    out.push({ type: "text", text: "Ne rien encaisser" });
  } else if (isCash) {
    out.push({
      type: "textBold",
      text: `A ENCAISSER : ${formatDA(order.total_da)}`,
    });
    out.push({ type: "size", value: SZ.small });
    out.push({ type: "text", text: "(paiement en especes au retrait)" });
  } else {
    out.push({ type: "textBold", text: formatDA(order.total_da) });
  }
  out.push({ type: "align", value: "left" });
  out.push({ type: "size", value: SZ.base });
  out.push({ type: "text", text: solidLine(cols) });

  divider();

  // ===== 11. CODE DE RETRAIT + QR =====
  out.push({ type: "align", value: "center" });
  out.push({ type: "size", value: SZ.small });
  out.push({ type: "text", text: "CODE DE RETRAIT" });
  out.push({ type: "size", value: SZ.large });
  out.push({ type: "textBoldStrong", text: spaceOut(order.pickup_code) });
  // QR encode UNIQUEMENT le code 6 chiffres : payload court → modules plus
  // gros → scan fiable sur thermique imprimé.
  out.push({
    type: "qr",
    data: order.pickup_code,
    moduleSize: opts.width === 80 ? 6 : 5,
    errorLevel: 3,
  });

  // ===== 12. FOOTER =====
  out.push({ type: "size", value: SZ.small });
  out.push({ type: "text", text: "- - - - - - - - - - -" });
  out.push({ type: "text", text: `Commande via ${opts.appName ?? "Coligo"}` });
  out.push({
    type: "text",
    text: `Imprime le ${formatShortDateTime(new Date().toISOString())}`,
  });

  // Reset final
  out.push({ type: "align", value: "left" });

  // Sanitization ASCII finale (firmware V3 strict)
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

  // Preview ASCII en console — visible dans logcat avant impression.
  try {
    console.info("[ticket-preview]\n" + previewAscii(sanitized, cols));
  } catch {
    /* ignored */
  }

  return sanitized;
}

/** Rendu ASCII approximatif des commandes pour debug logcat. */
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
