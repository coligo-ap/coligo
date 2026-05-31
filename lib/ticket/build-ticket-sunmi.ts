/**
 * Builder « commandes Sunmi » du ticket — parité visuelle avec le ticket
 * HTML (cf. `maquette-ticket-80mm.html`), via le SDK Sunmi AIDL pour
 * impression directe sans dialogue navigateur.
 *
 * Structure suivie (identique à la maquette) :
 *   1. nom commerce centré gras + localité
 *   2. "RETRAIT" en gras centré entre deux lignes pleines (zéro aplat noir —
 *      l'ancien bandeau inversé bavait sur thermique)
 *   3. #ID énorme (textBoldStrong → double-width)
 *   4. "RETRAIT À HH:MM" en gros
 *   5. méta : Commandé le / Client / Tél (colonnes label/valeur)
 *   6. badge "NOUVEAU CLIENT" optionnel
 *   7. articles groupés par catégorie : "— CATEGORIE (N) —" + lignes
 *      `qty× nom ........ prix DA`
 *   8. récap aligné à droite (sous-total, frais, réduction)
 *   9. TOTAL en gras fort
 *  10. bloc paiement (À ENCAISSER : X DA / PAYÉ EN LIGNE)
 *  11. QR de référence (order_number) centré, encadré de deux lignes pleines —
 *      jamais le PIN de retrait (secret communiqué de vive voix)
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

/**
 * Caractères par ligne en police par défaut (Font A, 12 dots/car) selon la
 * laize papier, à 8 dots/mm :
 *   - 50 mm (Sunmi V3, rouleau intégré) → ~384 dots imprimables → 32 car.
 *   - 58 mm (Sunmi V2)                  → ~384 dots             → 32 car.
 *   - 80 mm (imprimante comptoir)       → ~576 dots             → 48 car.
 * Le double-width (textBoldStrong) = 24 dots/car → moitié (16 ou 24 car.).
 */
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

/** Séparateur pointillé plein-papier (maquette : hr dashed). */
function dottedLine(cols: number): string {
  return "-".repeat(cols);
}

/** Séparateur plein (cf. divider-solid de la maquette). */
function solidLine(cols: number): string {
  return "=".repeat(cols);
}

/**
 * Mise en page « label à gauche / valeur à droite » sur UNE seule ligne
 * pré-paddée à `cols` caractères. On rend ces lignes via le chemin `text`
 * (= printLine → printColumnsText 1 colonne pleine largeur + emphase), le
 * MÊME chemin que les titres qui marquent bien le papier. La police par
 * défaut Sunmi (Font A) est monospace → le padding manuel aligne au dot
 * près, sans recourir au multi-colonnes printColumnsText (qui sortait
 * fantôme).
 */
function lineLR(left: string, right: string, cols: number): string {
  const r = right.length > cols ? right.slice(0, cols) : right;
  const maxL = cols - r.length - 1; // au moins 1 espace entre les deux
  const l =
    left.length > Math.max(0, maxL) ? left.slice(0, Math.max(0, maxL)) : left;
  const gap = Math.max(1, cols - l.length - r.length);
  return l + " ".repeat(gap) + r;
}

/**
 * Découpe un texte en lignes ≤ width, en cassant sur les espaces (greedy).
 * Un mot plus long que `width` est coupé durement (rare : nom collé). La
 * première ligne peut avoir une largeur différente (`firstWidth`) pour
 * laisser la place au prix sur la ligne d'en-tête.
 */
function wrapWords(
  text: string,
  firstWidth: number,
  restWidth: number
): string[] {
  const words = text.split(/\s+/).filter(Boolean);
  const lines: string[] = [];
  let cur = "";
  const widthFor = () => (lines.length === 0 ? firstWidth : restWidth);
  for (let w of words) {
    // Mot plus long que la largeur courante → coupe dure.
    while (w.length > widthFor()) {
      if (cur) {
        lines.push(cur);
        cur = "";
      }
      const wmax = widthFor();
      lines.push(w.slice(0, wmax));
      w = w.slice(wmax);
    }
    if (!cur) cur = w;
    else if (cur.length + 1 + w.length <= widthFor()) cur += " " + w;
    else {
      lines.push(cur);
      cur = w;
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [""];
}

/**
 * Lignes d'un article façon Deliveroo, calées sur `cols` :
 *   `2x Baguette tradition           100 DA`
 * Nom trop long → retour à la ligne propre, indenté sous le nom, le prix
 * restant aligné à droite sur la 1re ligne :
 *   `1x Sandwich poulet maison      1250 DA`
 *   `   artisanal extra`
 */
function itemLines(
  qty: string,
  name: string,
  price: string,
  cols: number
): string[] {
  const prefix = `${qty} `; // ex. "2x "
  const indent = " ".repeat(prefix.length);
  const firstNameW = Math.max(1, cols - prefix.length - price.length - 1);
  const restNameW = Math.max(1, cols - prefix.length);
  const nameLines = wrapWords(name, firstNameW, restNameW);
  const out: string[] = [];
  // 1re ligne : prefix + 1er segment du nom, prix collé à droite.
  out.push(lineLR(prefix + nameLines[0], price, cols));
  // Lignes suivantes : reste du nom, indenté sous le nom (pas de prix).
  for (let i = 1; i < nameLines.length; i++) {
    out.push(indent + nameLines[i]);
  }
  return out;
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

  // Mode de service → libellés (bandeau + heure + bloc paiement).
  const isDelivery = order.fulfillment_type === "delivery";
  const modeLabel = isDelivery ? "LIVRAISON" : "RETRAIT";
  const timeLabel = isDelivery ? "LIVRAISON A" : "RETRAIT A";
  const handoffWord = isDelivery ? "a la livraison" : "au retrait";

  // Config imprimante en TÊTE de séquence. Interligne LÉGER (≈ 0.75 mm) pour
  // un rendu aéré et professionnel — 0 dot collait les lignes.
  out.push({ type: "paper", columns: cols });
  out.push({ type: "lineSpacing", dots: 6 });

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

  // ===== 2. "RETRAIT" entre DEUX lignes pleines (zéro aplat noir) =====
  // L'ancien bandeau inversé (fond noir plein largeur) bavait sur thermique.
  // Deux lignes pleines + libellé gras centré = même hiérarchie visuelle,
  // rendu propre et net comme le « print test » Sunmi.
  out.push({ type: "align", value: "left" });
  out.push({ type: "size", value: SZ.base });
  out.push({ type: "text", text: solidLine(cols) });
  out.push({ type: "align", value: "center" });
  out.push({ type: "textBold", text: modeLabel });
  out.push({ type: "align", value: "left" });
  out.push({ type: "text", text: solidLine(cols) });

  // ===== 3. NUMÉRO DE COMMANDE ÉNORME (référence, textBoldStrong) =====
  out.push({ type: "align", value: "center" });
  out.push({ type: "size", value: SZ.large });
  out.push({
    type: "textBoldStrong",
    text: `#${order.order_number ?? shortId(order.id)}`,
  });

  // ===== 4. HEURE DE RETRAIT / LIVRAISON =====
  out.push({ type: "size", value: SZ.small });
  out.push({ type: "text", text: timeLabel });
  out.push({ type: "size", value: SZ.large });
  out.push({ type: "textBoldStrong", text: formatTime(order.pickup_slot_at) });

  // Adresse de livraison, centrée sous l'heure — UNIQUEMENT en livraison.
  // Wrap propre sur la laize (les noms de rue longs passent à la ligne).
  if (isDelivery && order.delivery_address) {
    out.push({ type: "align", value: "center" });
    out.push({ type: "size", value: SZ.base });
    for (const l of wrapWords(asciize(order.delivery_address), cols, cols)) {
      out.push({ type: "textBold", text: l });
    }
  }

  divider();

  // ===== 5. MÉTA (Client / Tél / Commandé le) =====
  // Rendu en lignes pré-paddées (chemin `text` = même rendu noir que les
  // titres), PAS en multi-colonnes printColumnsText (qui sortait fantôme).
  out.push({ type: "align", value: "left" });
  out.push({ type: "size", value: SZ.base });
  const metaRow = (l: string, r: string) => {
    out.push({ type: "text", text: lineLR(l, r, cols) });
  };
  metaRow("Client", order.customer_name);
  metaRow(
    "Tel",
    isDelivery
      ? (order.delivery_phone ?? order.customer_phone)
      : order.customer_phone
  );
  metaRow("Commande le", formatShortDateTime(order.created_at));

  // Instructions d'accès livraison (code porte, étage…) — sous la méta, en
  // petit, wrappées. Distinctes de la note de préparation (cf. plus bas).
  if (isDelivery && order.delivery_note) {
    out.push({ type: "size", value: SZ.small });
    for (const l of wrapWords(
      asciize(`Livraison: ${order.delivery_note}`),
      cols,
      cols
    )) {
      out.push({ type: "text", text: l });
    }
    out.push({ type: "size", value: SZ.base });
  }

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
    for (const g of groups) {
      // En-tête catégorie : titre gras à gauche (chemin textBold = noir net).
      out.push({ type: "align", value: "left" });
      out.push({
        type: "textBold",
        text: `${g.title.toUpperCase()} (${groupCount(g.items)})`,
      });
      // Lignes articles : `Nx Nom .......... prix`, calées sur la laize.
      // Nom trop long → retour à la ligne propre (chemin `text` = même noir
      // que les titres). asciize est appliqué en fin de builder.
      for (const it of g.items) {
        const qty = String(it.quantity).replace(/\.0+$/, "") + "x";
        const lines = itemLines(
          qty,
          asciize(it.product_name),
          formatDA(it.line_total_da),
          cols
        );
        for (const line of lines) {
          out.push({ type: "text", text: line });
        }
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
  const pushRecap = (label: string, value: string) => {
    out.push({ type: "text", text: lineLR(label, value, cols) });
  };
  out.push({ type: "align", value: "left" });
  out.push({ type: "size", value: SZ.base });
  if (discount > 0 || order.service_fee_da > 0 || order.cashback_da > 0) {
    pushRecap("Sous-total", formatDA(subtotal));
  }
  if (order.service_fee_da > 0) {
    pushRecap(
      isDelivery ? "Frais livraison" : "Frais service",
      formatDA(order.service_fee_da)
    );
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

  // ===== 9. TOTAL en gras fort (label gauche / montant droite, double taille) =====
  // textBoldStrong = double largeur (ESC ! ) → budget colonnes halvé à cols/2.
  // On pré-padde la ligne sur cols/2 pour que « TOTAL ........ 1750 DA »
  // remplisse toute la largeur en double taille, noir et net.
  out.push({ type: "align", value: "left" });
  out.push({ type: "size", value: SZ.large });
  out.push({
    type: "textBoldStrong",
    text: lineLR("TOTAL", formatDA(order.total_da), Math.floor(cols / 2)),
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
    out.push({ type: "text", text: `(paiement en especes ${handoffWord})` });
  } else {
    out.push({ type: "textBold", text: formatDA(order.total_da) });
  }
  out.push({ type: "align", value: "left" });
  out.push({ type: "size", value: SZ.base });
  out.push({ type: "text", text: solidLine(cols) });

  divider();

  // ===== 11. QR DE RÉFÉRENCE — centré, encadré de DEUX lignes pleines =====
  // Comme le « print test » Sunmi : du texte, deux lignes de séparation, puis
  // le QR. Encode UNIQUEMENT la référence publique (jamais le PIN de retrait —
  // secret communiqué de vive voix). QR natif `printQRCode` = rendu crisp.
  const ref = order.order_number ?? shortId(order.id);
  out.push({ type: "align", value: "left" });
  out.push({ type: "size", value: SZ.base });
  out.push({ type: "text", text: solidLine(cols) }); // ligne 1
  out.push({ type: "align", value: "center" });
  out.push({ type: "size", value: SZ.small });
  out.push({ type: "text", text: "REFERENCE COMMANDE" });
  out.push({ type: "qr", data: ref, moduleSize: 8, errorLevel: 2 });
  out.push({ type: "size", value: SZ.base });
  out.push({ type: "textBold", text: `#${ref}` });
  out.push({ type: "align", value: "left" });
  out.push({ type: "size", value: SZ.base });
  out.push({ type: "text", text: solidLine(cols) }); // ligne 2

  out.push({ type: "wrap", n: 1 });

  // ===== 12. MERCI + FOOTER (centré) =====
  out.push({ type: "align", value: "center" });
  out.push({ type: "size", value: SZ.base });
  out.push({ type: "textBold", text: "Merci et a bientot !" });
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
