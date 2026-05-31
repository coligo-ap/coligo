/**
 * Builder HTML du ticket de commande — Coligo, format 80mm thermique (Sunmi V3).
 *
 * Rendu calé EXACTEMENT sur la maquette `maquette-ticket-80mm.html` :
 *  - largeur cible 80mm rouleau, zone imprimable ~72mm ;
 *  - noir et blanc strict, contrastes forts ;
 *  - police principale `Courier New` (chasse fixe pour aligner les colonnes),
 *    police d'accent `Sora` (Google Fonts) pour shopname, #ID et code retrait ;
 *  - hiérarchie visuelle dominante : banner inversé → #ID 34px → heure 20px
 *    → bloc paiement encadré → code retrait + QR.
 *
 * Le 58mm reste supporté pour les imprimantes tierces : on snap la largeur
 * et on garde la même structure (les tailles px en `ch` ne sont pas
 * affectées par la laize papier — seul le conteneur change).
 *
 * Le QR encode UNIQUEMENT la référence PUBLIQUE de la commande (order_number,
 * ex. « A042 ») — JAMAIS le PIN de retrait (secret). Payload court → modules
 * plus gros → scan fiable sur thermique. Il est encadré de deux lignes pleines
 * (séparation nette texte ↔ code), à la manière du « print test » Sunmi.
 *
 * Largeur cible : rouleau 80mm, zone imprimable 76mm (padding 2mm/côté côté
 * conteneur). Imprimable via `printTicket()` (window.print() PWA, SDK Sunmi APK).
 */

import type { FulfillmentType, PrintWidth } from "@/lib/types";
import { qrSvg } from "@/lib/ticket/qr-svg";

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
  /** Localité du commerce (ex. "Béjaïa · Akbou"). Affichée sous le nom. */
  merchant_locality?: string | null;
  customer_name: string;
  customer_phone: string;
  /** Référence de communication (ex. « A042 »). Affichée en gros sur le ticket. */
  order_number?: string | null;
  /** PIN de validation — NON imprimé. Conservé pour compat de type uniquement. */
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
  /** Si vrai, affiche un badge encadré "★ NOUVEAU CLIENT ★". */
  is_new_customer?: boolean;
  /**
   * Mode de service. "delivery" → libellés LIVRAISON ; sinon (défaut)
   * "pickup" → RETRAIT.
   */
  fulfillment_type?: FulfillmentType;
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

/** « 26/05 13:45 » — format compact pour les rows Commandé le / Imprimé le. */
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

/** Compte les unités d'un groupe (somme arrondie des quantités). */
function groupCount(items: TicketItem[]): number {
  return items.reduce((s, it) => s + Number(it.quantity || 0), 0);
}

/**
 * Regroupe par catégorie, ordre = première apparition. Items sans
 * catégorie → groupe « Articles ».
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

// ===========================================================================
// Builder principal
// ===========================================================================

export async function buildTicketHTML(
  order: TicketOrder,
  opts: BuildTicketOptions
): Promise<BuiltTicket> {
  const w = opts.width;
  // Le rendu est calé sur 80mm (maquette). En 58mm on garde la même
  // structure ; les tailles se contractent visuellement avec la laize.
  const isPaidOnline =
    order.payment_method === "online" && order.payment_status === "paid";
  const isCash = order.payment_method === "cash";

  // Mode de service → libellés (bandeau + heure + bloc paiement).
  const isDelivery = order.fulfillment_type === "delivery";
  const modeLabel = isDelivery ? "LIVRAISON" : "RETRAIT";
  const timeLabel = isDelivery ? "LIVRAISON À" : "RETRAIT À";
  const handoffWord = isDelivery ? "à la livraison" : "au retrait";

  const subtotal = order.items.reduce((s, it) => s + it.line_total_da, 0);
  const discount = Math.max(
    0,
    subtotal + order.service_fee_da - order.total_da
  );
  const groups = groupByCategory(order.items);

  // ─── Articles groupés ───────────────────────────────────────────────────
  // Format : `2x Baguette tradition          60 DA` + `↳ note client` italique
  // sous le DERNIER item de la dernière catégorie (la note est par commande,
  // pas par item — on l'attache visuellement comme une instruction de prépa).
  const noteForDisplay =
    order.notes && order.notes !== "seed" ? order.notes : null;
  const itemsHtml = groups
    .map((g, gi) => {
      const isLastGroup = gi === groups.length - 1;
      const count = groupCount(g.items);
      const rows = g.items
        .map((it, ii) => {
          const isLastItem = isLastGroup && ii === g.items.length - 1;
          const qty = String(it.quantity).replace(/\.0+$/, "");
          const noteHtml =
            isLastItem && noteForDisplay
              ? `<div class="item opt">↳ ${escapeHtml(noteForDisplay)}</div>`
              : "";
          return `
            <div class="item">
              <span class="qty">${escapeHtml(qty)}x</span>
              <span class="nm">${escapeHtml(it.product_name)}</span>
              <span class="pr">${escapeHtml(formatDA(it.line_total_da))}</span>
            </div>${noteHtml}`;
        })
        .join("");
      return `
        <div class="cat-h">— ${escapeHtml(g.title)} (${count}) —</div>
        ${rows}`;
    })
    .join("");

  // ─── Récap ──────────────────────────────────────────────────────────────
  const recapRows: string[] = [];
  if (discount > 0 || order.service_fee_da > 0 || order.cashback_da > 0) {
    recapRows.push(rowLR("Sous-total", formatDA(subtotal)));
  }
  if (order.service_fee_da > 0) {
    recapRows.push(
      rowLR(
        isDelivery ? "Frais livraison" : "Frais service",
        formatDA(order.service_fee_da)
      )
    );
  }
  if (discount > 0) {
    const pct = subtotal > 0 ? Math.round((discount / subtotal) * 100) : 0;
    const label = pct > 0 ? `Réduction -${pct}%` : "Réduction";
    recapRows.push(rowLR(label, `-${formatDA(discount)}`));
  }
  if (order.cashback_da > 0) {
    recapRows.push(rowLR("Cashback", `-${formatDA(order.cashback_da)}`));
  }

  // ─── Bloc paiement (adaptatif sans ambiguïté) ──────────────────────────
  const payBlock = isPaidOnline
    ? `<div class="pay double">✓ PAYÉ EN LIGNE<br><span class="pay-sub">Ne rien encaisser</span></div>`
    : isCash
      ? `<div class="pay">À ENCAISSER : ${escapeHtml(formatDA(order.total_da))}<br><span class="pay-sub">(paiement en espèces ${handoffWord})</span></div>`
      : `<div class="pay">${escapeHtml(formatDA(order.total_da))}</div>`;

  const copyBanner = opts.copyLabel
    ? `<div class="copy">${escapeHtml(opts.copyLabel)}</div>`
    : "";

  const badgeNewClient = order.is_new_customer
    ? `<div class="badge-new">★ NOUVEAU CLIENT ★</div>`
    : "";

  const locality = order.merchant_locality
    ? `<div class="sub">${escapeHtml(order.merchant_locality)}</div>`
    : "";

  // ─── QR de référence ────────────────────────────────────────────────────
  // Encadré par DEUX lignes pleines (séparation nette texte ↔ code, à la
  // manière du « print test » Sunmi). Encode UNIQUEMENT la référence publique
  // de la commande (jamais le PIN de retrait). Référence courte → QR version
  // basse → modules gros → scan fiable sur thermique.
  const ref = order.order_number ?? shortId(order.id);
  const qrMarkup = await qrSvg(ref);
  const qrBlock = `
  <hr class="divider-solid">
  <div class="code-label">REFERENCE COMMANDE</div>
  <div class="qr-wrap">${qrMarkup}</div>
  <div class="qr-ref">#${escapeHtml(ref)}</div>
  <hr class="divider-solid">`;

  // ─── Styles : repris à l'identique de la maquette ───────────────────────
  // La police Sora est chargée via Google Fonts. Sur Sunmi V3 sans réseau, le
  // fallback Courier New gras se substitue (rendu thermique reste correct).
  const styles = `
    @import url('https://fonts.googleapis.com/css2?family=Sora:wght@700;800&display=swap');

    .tk {
      color: #000; background: #fff;
      font-family: 'Courier New', 'Consolas', monospace;
      font-size: 13px; line-height: 1.45;
      width: 100%;
      -webkit-print-color-adjust: exact;
      print-color-adjust: exact;
    }
    .tk * { box-sizing: border-box; margin: 0; padding: 0; }

    .tk .center  { text-align: center; }
    .tk .big     { font-size: 15px; font-weight: bold; }

    /* En-tête : nom commerce + localité */
    .tk .shopname {
      font-family: 'Sora', 'Courier New', sans-serif;
      font-size: 18px; font-weight: 800;
      text-align: center; letter-spacing: .5px;
    }
    .tk .sub { text-align: center; font-size: 11px; margin-top: 2px; }

    /* Copie : petit bandeau au-dessus si multi-exemplaires */
    .tk .copy {
      text-align: center; font-weight: 700; font-size: 11px;
      letter-spacing: 2px; border: 1px solid #000;
      padding: 2px 0; margin-bottom: 6px;
    }

    /* Séparateurs */
    .tk .divider       { border: none; border-top: 1px dashed #000; margin: 10px 0; }
    .tk .divider-solid { border: none; border-top: 2px solid #000; margin: 10px 0; }
    .tk .divider-solid.tight { margin: 6px 0 4px; }
    .tk .divider-solid.tight + .banner-label + .divider-solid.tight { margin: 4px 0 6px; }

    /* "RETRAIT" — libellé dominant, gras centré (pas d'aplat noir) */
    .tk .banner-label {
      text-align: center; font-weight: bold; font-size: 16px;
      letter-spacing: 3px; margin: 2px 0;
    }

    /* #ID énorme — l'élément dominant */
    .tk .ordernum {
      font-family: 'Sora', 'Courier New', sans-serif;
      text-align: center; font-size: 34px; font-weight: 800;
      letter-spacing: 1px; margin: 6px 0 2px;
    }

    /* Heure de retrait */
    .tk .pickup { text-align: center; font-size: 20px; font-weight: bold; margin: 4px 0; }
    .tk .pickup small {
      display: block; font-size: 11px; font-weight: normal; letter-spacing: 1px;
    }

    /* Rows label/valeur (Commandé le, Client, Tél, recap) */
    .tk .row { display: flex; justify-content: space-between; gap: 8px; }
    .tk .row .l { flex: 1; }
    .tk .row .r { text-align: right; white-space: nowrap; }

    /* Badge "NOUVEAU CLIENT" */
    .tk .badge-new {
      text-align: center; border: 1.5px dashed #000;
      padding: 5px; font-weight: bold; font-size: 12px;
      margin: 8px 0; letter-spacing: .5px;
    }

    /* Catégorie + items */
    .tk .cat-h {
      font-weight: bold; text-transform: uppercase; font-size: 12px;
      margin: 8px 0 3px; letter-spacing: .5px;
    }
    .tk .item { display: flex; gap: 8px; margin: 2px 0; }
    .tk .item .qty { font-weight: bold; min-width: 26px; }
    .tk .item .nm  { flex: 1; word-break: break-word; }
    .tk .item .pr  { text-align: right; white-space: nowrap; }
    .tk .item.opt  {
      font-size: 11px; padding-left: 34px; font-style: italic;
      display: block;
    }

    /* Totaux */
    .tk .total-row {
      display: flex; justify-content: space-between;
      font-size: 16px; font-weight: bold; margin-top: 4px;
    }

    /* Bloc paiement encadré (2px solid cash, double payé en ligne) */
    .tk .pay {
      text-align: center; font-size: 15px; font-weight: bold;
      border: 2px solid #000; padding: 7px; margin: 10px 0;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    .tk .pay.double  { border-style: double; border-width: 4px; }
    .tk .pay .pay-sub { font-size: 11px; font-weight: normal; }

    /* Référence + QR */
    .tk .code-label { text-align: center; font-size: 11px; letter-spacing: 2px; margin-top: 6px; }
    .tk .qr-wrap { display: flex; justify-content: center; margin: 6px 0 2px; }
    .tk .qr-wrap svg {
      display: block; width: 40mm; height: 40mm;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    .tk .qr-ref {
      font-family: 'Sora', 'Courier New', sans-serif;
      text-align: center; font-size: 22px; font-weight: 800;
      letter-spacing: 1px; margin: 2px 0 4px;
    }

    /* Remerciement + pied de ticket */
    .tk .thanks { text-align: center; font-weight: bold; font-size: 13px; margin-top: 12px; }
    .tk .foot { text-align: center; font-size: 11px; margin-top: 6px; }
    .tk .foot-sep { letter-spacing: 2px; }
  `;

  const html = `
<div class="tk">
  ${copyBanner}

  <!-- 1. Header : nom commerce + localité -->
  <div class="shopname">${escapeHtml(order.merchant_name)}</div>
  ${locality}

  <!-- 2. Mode (RETRAIT/LIVRAISON) en gras entre deux lignes pleines -->
  <hr class="divider-solid tight">
  <div class="banner-label">${modeLabel}</div>
  <hr class="divider-solid tight">

  <!-- 3. Numéro de commande énorme (référence de communication) -->
  <div class="ordernum">#${escapeHtml(order.order_number ?? shortId(order.id))}</div>

  <!-- 4. Heure de retrait / livraison -->
  <div class="pickup"><small>${timeLabel}</small>${escapeHtml(formatTime(order.pickup_slot_at))}</div>

  <hr class="divider">

  <!-- 5. Méta commande/client -->
  <div class="row"><span class="l">Commandé le</span><span class="r">${escapeHtml(formatShortDateTime(order.created_at))}</span></div>
  <div class="row"><span class="l">Client</span><span class="r">${escapeHtml(order.customer_name)}</span></div>
  <div class="row"><span class="l">Tél</span><span class="r">${escapeHtml(order.customer_phone)}</span></div>

  ${badgeNewClient}

  <hr class="divider">

  <!-- 6. Articles groupés par catégorie -->
  ${itemsHtml || '<div class="cat-h">— Articles (0) —</div>'}

  <hr class="divider">

  <!-- 7. Récap aligné droite + total -->
  ${recapRows.join("")}
  <div class="total-row"><span>TOTAL</span><span>${escapeHtml(formatDA(order.total_da))}</span></div>

  <!-- 8. Bloc paiement -->
  ${payBlock}

  <!-- 9. QR de référence, encadré de deux lignes pleines.
          (Le CODE PIN de validation n'est JAMAIS imprimé : c'est un secret que
          le client communique de vive voix au retrait / à la livraison.) -->
  ${qrBlock}

  <!-- 10. Remerciement + footer -->
  <div class="thanks">Merci et à bientôt !</div>
  <div class="foot">
    <span class="foot-sep">— — — — — — — — — — —</span><br/>
    Commande via ${escapeHtml(opts.appName ?? "Coligo")}<br/>
    Imprimé le ${escapeHtml(formatShortDateTime(new Date().toISOString()))}
  </div>
</div>
<style>${styles}</style>
`;

  return { html, widthMm: w };
}

/** Une ligne label/valeur (recap). */
function rowLR(label: string, value: string): string {
  return `<div class="row"><span class="l">${escapeHtml(label)}</span><span class="r">${escapeHtml(value)}</span></div>`;
}
