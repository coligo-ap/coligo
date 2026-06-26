/**
 * Builder « commandes Sunmi » du ticket — impression thermique NATIVE (ESC/POS
 * Font A) via le SDK Sunmi AIDL, sans dialogue navigateur, sans image.
 *
 * Reproduit la maquette cible style Deliveroo (`apercu-ticket-deliveroo.html`) :
 *   1. logo Coligo + nom boutique (centrés)
 *   2. bandeau INVERSÉ combinant mode + paiement : « LIVRAISON · PAYÉ »,
 *      « RETRAIT · CASH »… (une seule ligne, pas d'état séparé)
 *   3. #numéro de commande ÉNORME, aligné à gauche (référence publique)
 *   4. « Livrer pour : HH:MM » / « Retrait pour : HH:MM »
 *   5. Précisions particulières (si note client)
 *   6. ARTICLES groupés par catégorie — « Nx Nom » SANS prix (ticket cuisine)
 *   7. récap : Nombre de produits / Sous-total / Frais / Total (ou À ENCAISSER)
 *   8. bloc infos : Heure commande / Client / Téléphone / Adresse (livraison)
 *   9. pied : « Code remis par le client au livreur (non imprimé) » (livraison)
 *      ou « Merci de votre confiance » (retrait)
 *
 * Le PIN de retrait (4 chiffres) n'est JAMAIS imprimé — seul le numéro de
 * commande public l'est.
 *
 * Toute la config (laize → colonnes, tailles, libellés mode/paiement) vient de
 * `ticket-format.ts`, source partagée avec le builder HTML/aperçu.
 */

import type { TicketOrder } from "@/lib/ticket/build-ticket-html";
import type { PrintWidth } from "@/lib/types";
import type { SunmiAlign, SunmiCommand } from "@/lib/native/sunmi-printer";
import {
  columnsForWidth,
  deriveTicketMeta,
  formatDA,
  formatOrderClock,
  formatQtyUnit,
  formatTime,
  groupByCategory,
  groupCount,
  loyaltyInfo,
  orderRef,
  promoTypeLabel,
  SUNMI_LINE_SPACING,
  SUNMI_SIZE as SZ,
  totalUnits,
} from "@/lib/ticket/ticket-format";

export type BuildSunmiOptions = {
  width: PrintWidth;
  appName?: string;
  copyLabel?: string;
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
    .replace(/ /g, " ") // NBSP
    .replace(/[^\x20-\x7E\n]/g, "");
}

/**
 * Mise en page « label à gauche / valeur à droite » sur UNE ligne pré-paddée à
 * `cols` caractères. Police par défaut Sunmi (Font A) = monospace → le padding
 * manuel aligne au dot près, sans multi-colonnes (qui sortait fantôme).
 */
function lineLR(left: string, right: string, cols: number): string {
  const r = right.length > cols ? right.slice(0, cols) : right;
  const maxL = cols - r.length - 1;
  const l =
    left.length > Math.max(0, maxL) ? left.slice(0, Math.max(0, maxL)) : left;
  const gap = Math.max(1, cols - l.length - r.length);
  return l + " ".repeat(gap) + r;
}

/**
 * Découpe un texte en lignes ≤ width (greedy sur les espaces). Un mot plus long
 * que `width` est coupé durement. `firstWidth` peut différer de `restWidth`.
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
 * Lignes d'un article façon Deliveroo (ticket cuisine, SANS prix) :
 *   `2x Baguette tradition`
 * Nom trop long → retour à la ligne propre, indenté sous le nom :
 *   `1x Sandwich poulet maison`
 *   `   artisanal extra`
 */
function itemLines(qty: string, name: string, cols: number): string[] {
  const prefix = `${qty} `; // ex. "2x "
  const indent = " ".repeat(prefix.length);
  const firstW = Math.max(1, cols - prefix.length);
  const nameLines = wrapWords(name, firstW, firstW);
  const out: string[] = [prefix + nameLines[0]];
  for (let i = 1; i < nameLines.length; i++) out.push(indent + nameLines[i]);
  return out;
}

export function buildTicketSunmiCommands(
  order: TicketOrder,
  opts: BuildSunmiOptions
): SunmiCommand[] {
  const out: SunmiCommand[] = [];
  const cols = columnsForWidth(opts.width);
  const meta = deriveTicketMeta(order);

  // Config imprimante en TÊTE de séquence : laize (colonnes) + interligne léger.
  out.push({ type: "paper", columns: cols });
  out.push({ type: "lineSpacing", dots: SUNMI_LINE_SPACING });

  const divider = () => {
    out.push({ type: "align", value: "left" });
    out.push({ type: "size", value: SZ.base });
    out.push({ type: "text", text: "-".repeat(cols) });
  };

  // === COPIE k/N ===
  if (opts.copyLabel) {
    out.push({ type: "align", value: "center" });
    out.push({ type: "size", value: SZ.small });
    out.push({ type: "textBold", text: opts.copyLabel });
  }

  // ===== 1. EN-TÊTE : logo Coligo (AGRANDI) + nom boutique (centrés) =====
  out.push({ type: "align", value: "center" });
  out.push({ type: "size", value: SZ.large });
  out.push({ type: "textBoldStrong", text: opts.appName ?? "Coligo" });
  out.push({ type: "size", value: SZ.base });
  out.push({ type: "text", text: order.merchant_name });

  // ===== 2. BANDEAU INVERSÉ mode + paiement (une seule ligne) =====
  // « LIVRAISON · PAYÉ », « RETRAIT · CASH »… Fond noir / texte blanc via GS B.
  out.push({ type: "align", value: "center" });
  out.push({ type: "size", value: SZ.base });
  out.push({ type: "textInverse", text: ` ${meta.bannerText} ` });

  // ===== 3. NUMÉRO DE COMMANDE ÉNORME, CENTRÉ (comme le QR auparavant) =====
  out.push({ type: "align", value: "center" });
  out.push({ type: "size", value: SZ.large });
  out.push({ type: "textBoldStrong", text: `#${orderRef(order)}` });

  // ===== 4. « Livrer pour : HH:MM » / « Retrait pour : HH:MM » =====
  out.push({ type: "align", value: "center" });
  out.push({ type: "size", value: SZ.base });
  out.push({
    type: "textBold",
    text: `${meta.timeLineLabel} : ${formatTime(order.pickup_slot_at)}`,
  });

  divider();

  // ===== 5. PRÉCISIONS PARTICULIÈRES (si note client) =====
  const note = order.notes && order.notes !== "seed" ? order.notes : null;
  if (note) {
    out.push({ type: "align", value: "left" });
    out.push({ type: "size", value: SZ.base });
    out.push({ type: "textBold", text: "Precisions particulieres" });
    for (const l of wrapWords(asciize(note), cols, cols)) {
      out.push({ type: "text", text: l });
    }
    divider();
  }

  // ===== 6. ARTICLES groupés par catégorie — SANS prix =====
  out.push({ type: "align", value: "left" });
  out.push({ type: "size", value: SZ.base });
  const groups = groupByCategory(order.items);
  if (groups.length === 0) {
    out.push({ type: "text", text: "(aucun article)" });
  } else {
    for (const g of groups) {
      out.push({
        type: "textBold",
        text: `${g.title.toUpperCase()} (${groupCount(g.items)})`,
      });
      for (const it of g.items) {
        const qty = formatQtyUnit(it.quantity, it.unit).replace("×", "x");
        const name = asciize(it.product_name) + (it.is_free ? " [OFFERT]" : "");
        for (const line of itemLines(qty, name, cols)) {
          out.push({ type: "textBold", text: line });
        }
        // Options/variantes sous l'article (FR, ASCII — chemin thermique).
        for (const o of it.options ?? []) {
          const delta = o.price_delta_da
            ? ` (${o.price_delta_da > 0 ? "+" : ""}${formatDA(o.price_delta_da)})`
            : "";
          out.push({
            type: "text",
            text: "  + " + asciize(o.option_name_fr) + delta,
          });
        }
      }
    }
  }

  divider();

  // ===== 7. RÉCAP (Nombre de produits / Sous-total / Frais / réductions) =====
  out.push({ type: "align", value: "left" });
  out.push({ type: "size", value: SZ.base });
  const recap = (label: string, value: string) => {
    out.push({ type: "text", text: lineLR(label, value, cols) });
  };
  recap("Nombre de produits", String(totalUnits(order.items)));
  recap("Sous-total", formatDA(meta.subtotalDa));
  if (order.service_fee_da > 0) {
    recap(meta.feeLabel, formatDA(order.service_fee_da));
  }
  // Réduction générique : uniquement si AUCUN détail promo itémisé.
  if (meta.discountDa > 0 && (order.promotions?.length ?? 0) === 0) {
    const pct =
      meta.subtotalDa > 0
        ? Math.round((meta.discountDa / meta.subtotalDa) * 100)
        : 0;
    recap(
      pct > 0 ? `Reduction -${pct}%` : "Reduction",
      `-${formatDA(meta.discountDa)}`
    );
  }
  // Promotions itémisées (FR/ASCII) — type + titre + montant/offert.
  for (const p of order.promotions ?? []) {
    const right =
      p.free_qty > 0 ? `${p.free_qty}x offert` : `-${formatDA(p.discount_da)}`;
    const label = asciize(`${promoTypeLabel(p.type).fr} ${p.title_fr}`).slice(
      0,
      cols - 12
    );
    recap(label, right);
  }
  if (order.cashback_da > 0) {
    recap("Cashback", `-${formatDA(order.cashback_da)}`);
  }

  // ===== 8. TOTAL / À ENCAISSER en gras, pleine largeur =====
  // PAS de double-width ici : « A ENCAISSER » + montant déborderait le budget
  // colonnes/2. Comme la maquette (total = gras modeste, seul le #commande est
  // en taille double), on rend une ligne gras pleine largeur, jamais tronquée.
  out.push({ type: "align", value: "left" });
  out.push({ type: "size", value: SZ.base });
  out.push({
    type: "textBold",
    text: lineLR(meta.totalLabel, formatDA(order.total_da), cols),
  });
  if (meta.isCash) {
    out.push({ type: "align", value: "center" });
    out.push({ type: "size", value: SZ.small });
    out.push({ type: "text", text: `paiement en especes ${meta.handoffWord}` });
  }

  divider();

  // ===== 9. BLOC INFOS : Heure commande / Client / Téléphone / Adresse =====
  out.push({ type: "align", value: "left" });
  out.push({ type: "size", value: SZ.base });
  const infoLine = (label: string, value: string) => {
    for (const l of wrapWords(asciize(`${label} : ${value}`), cols, cols)) {
      out.push({ type: "text", text: l });
    }
  };
  infoLine("Heure commande", formatOrderClock(order.created_at));
  infoLine("Client", order.customer_name);
  infoLine(
    "Telephone",
    meta.isDelivery
      ? (order.delivery_phone ?? order.customer_phone)
      : order.customer_phone
  );
  if (meta.isDelivery && order.delivery_address) {
    infoLine("Adresse", order.delivery_address);
  }
  // Instructions d'accès livraison (code porte, étage…), si présentes.
  if (meta.isDelivery && order.delivery_note) {
    infoLine("Acces", order.delivery_note);
  }

  divider();

  // ===== 10. PIED dépendant du mode =====
  out.push({ type: "align", value: "center" });
  out.push({ type: "size", value: SZ.base });
  for (const l of wrapWords(asciize(meta.footerText), cols, cols)) {
    out.push({ type: "textBold", text: l });
  }

  // ===== 11. QR de la RÉFÉRENCE publique (jamais le PIN secret), centré =====
  out.push({ type: "align", value: "center" });
  out.push({ type: "qr", data: orderRef(order), moduleSize: 6, errorLevel: 2 });
  out.push({ type: "size", value: SZ.small });
  out.push({ type: "text", text: `N ${orderRef(order)}` });

  // ===== 12. FIDÉLITÉ CLIENT (après le QR) =====
  // Le firmware thermique n'imprime pas d'emoji → on rend le panier en ASCII
  // (asciize stripperait 🛒). 1re commande = message ; sinon paniers (≤3) ou
  // « N x [panier] ».
  const loyalty = loyaltyInfo(order.customer_order_count);
  if (loyalty) {
    out.push({ type: "wrap", n: 1 });
    out.push({ type: "align", value: "center" });
    out.push({ type: "size", value: SZ.base });
    if (loyalty.first) {
      out.push({ type: "textBold", text: "Premiere commande" });
    } else {
      const basket = "[_]"; // mini-panier ASCII
      const baskets =
        loyalty.count <= 3
          ? Array(loyalty.count).fill(basket).join(" ")
          : `${loyalty.count} x ${basket}`;
      out.push({ type: "textBold", text: `${loyalty.count}e commande` });
      out.push({ type: "text", text: baskets });
    }
  }

  // ===== 13. REMERCIEMENT, avec espace papier AU-DESSUS pour déchirer =====
  // 2 lignes vides au-dessus de la phrase → la déchirure ne coupe jamais
  // « Merci pour votre confiance » (demande commerçant).
  out.push({ type: "wrap", n: 2 });
  out.push({ type: "align", value: "center" });
  out.push({ type: "size", value: SZ.base });
  out.push({ type: "textBold", text: "Merci pour votre confiance" });

  // Marge de découpe : 4 lignes vides en bas pour que la déchirure du ticket
  // n'abîme pas le contenu (demande commerçant).
  out.push({ type: "wrap", n: 4 });
  out.push({ type: "align", value: "left" });

  // Sanitization ASCII finale (firmware V3 strict).
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
