/**
 * Builder HTML du ticket de commande — aperçu écran + impression navigateur
 * (PWA / desktop). Rendu calé EXACTEMENT sur la maquette cible style Deliveroo
 * (`apercu-ticket-deliveroo.html`) :
 *   - police SANS-SERIF dense (Arial/Helvetica), jamais serif/Courier ;
 *   - bandeau INVERSÉ combinant mode + paiement (« LIVRAISON · PAYÉ ») ;
 *   - numéro de commande énorme aligné à gauche ;
 *   - articles SANS prix (ticket cuisine), récap avec Nombre de produits ;
 *   - bloc infos client en bas (adresse uniquement en livraison) ;
 *   - pied dépendant du mode.
 *
 * Structure + libellés IDENTIQUES au builder thermique `build-ticket-sunmi.ts`
 * (les deux consomment `ticket-format.ts`) → l'aperçu reflète exactement ce qui
 * sera imprimé.
 *
 * Le PIN de retrait n'est JAMAIS imprimé ; seul le numéro de commande public
 * (order_number) apparaît.
 */

import type { FulfillmentType, PrintWidth } from "@/lib/types";
import { BRAND_ASSETS } from "@/lib/config/brand-assets";
import {
  deriveTicketMeta,
  formatDA,
  formatOrderClock,
  formatQtyUnit,
  formatScheduleClock,
  formatTime,
  groupByCategory,
  groupCount,
  loyaltyInfo,
  orderRef,
  ordinalFr,
  promoTypeLabel,
  totalUnits,
  truncateName,
} from "@/lib/ticket/ticket-format";
import { qrSvg } from "@/lib/ticket/qr-svg";

/** Une option/variante choisie (snapshot bilingue). */
export type TicketItemOption = {
  group_name_fr: string;
  group_name_ar: string | null;
  option_name_fr: string;
  option_name_ar: string | null;
  price_delta_da: number;
};

export type TicketItem = {
  product_name: string;
  /** Nom AR (snapshot) — ticket bilingue. */
  product_name_ar?: string | null;
  quantity: number;
  unit_price_da: number;
  line_total_da: number;
  /** Unité de vente (piece/kg/l/m/custom) — affichage vrac « 0,75 kg ». */
  unit?: string | null;
  /** Article offert (promo buy-x-get-y) → badge « OFFERT ». */
  is_free?: boolean;
  /** Options/variantes choisies, affichées sous l'article. */
  options?: TicketItemOption[];
  /** Optionnel — si présent, l'item est groupé sous cette catégorie. */
  category_name?: string;
};

/** Promotion appliquée à la commande (snapshot, pour le récap du ticket). */
export type TicketPromotion = {
  type: string;
  title_fr: string;
  title_ar: string | null;
  discount_da: number;
  free_qty: number;
};

export type TicketOrder = {
  id: string;
  merchant_name: string;
  /** Localité du commerce (ex. "Béjaïa · Akbou"). Non imprimée (kitchen ticket). */
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
  /** Si vrai, affiche un badge "NOUVEAU CLIENT". */
  is_new_customer?: boolean;
  /**
   * Nombre TOTAL de commandes de ce client chez ce commerçant (courante
   * incluse). Imprimé sous le QR : 1 → « Première commande », sinon paniers.
   */
  customer_order_count?: number | null;
  /**
   * Mode de service. "delivery" → libellés LIVRAISON ; sinon (défaut)
   * "pickup" → RETRAIT.
   */
  fulfillment_type?: FulfillmentType;
  /** Adresse de livraison (snapshot) — affichée pour les commandes LIVRAISON. */
  delivery_address?: string | null;
  /** Téléphone de contact livraison (peut différer du client). */
  delivery_phone?: string | null;
  /** Instructions d'accès livraison (« code porte », « 3e étage »…). */
  delivery_note?: string | null;
  /** Promotions appliquées (snapshot) — résumé bilingue en bas de ticket. */
  promotions?: TicketPromotion[];
  /**
   * Si la commande est PROGRAMMÉE (créneau futur), date/heure cible ISO → un
   * bandeau « COMMANDE PROGRAMMÉE » bien visible est imprimé en haut du ticket.
   * null/absent pour une commande immédiate.
   */
  scheduled_for?: string | null;
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

/**
 * Bloc fidélité imprimé sous le QR. Première commande → message dédié ; sinon
 * des paniers 🛒 (jusqu'à 3), au-delà « N× 🛒 », avec le rang en légende.
 */
function loyaltyHtml(order: TicketOrder): string {
  const info = loyaltyInfo(order.customer_order_count);
  if (!info) return "";
  if (info.first) {
    return `  <div class="t-loyalty"><div class="t-loyalty-first">Première commande</div></div>\n`;
  }
  const baskets =
    info.count <= 3 ? "🛒".repeat(info.count) : `${info.count}× 🛒`;
  return `  <div class="t-loyalty"><div class="t-loyalty-baskets">${baskets}</div><div class="t-loyalty-cap">${ordinalFr(
    info.count
  )} commande de ce client</div></div>\n`;
}

/** Une ligne récap label/valeur. */
function rowLR(label: string, value: string, big = false): string {
  return `<div class="t-row${big ? " big" : ""}"><span>${escapeHtml(
    label
  )} :</span><span>${escapeHtml(value)}</span></div>`;
}

// ===========================================================================
// Builder principal
// ===========================================================================

export async function buildTicketHTML(
  order: TicketOrder,
  opts: BuildTicketOptions
): Promise<BuiltTicket> {
  const w = opts.width;
  const meta = deriveTicketMeta(order);
  const groups = groupByCategory(order.items);
  // QR de la RÉFÉRENCE publique de commande (jamais le PIN secret). Court →
  // QR basse version, modules gros, scan fiable en thermique.
  const qr = await qrSvg(orderRef(order), { margin: 2 });

  // ─── Articles groupés (SANS prix — ticket cuisine façon Deliveroo) ───────
  const itemsHtml =
    groups.length === 0
      ? `<div class="t-cat">ARTICLES (0)</div>`
      : groups
          .map((g) => {
            const rows = g.items
              .map((it) => {
                const qty = escapeHtml(formatQtyUnit(it.quantity, it.unit));
                const nameFr = escapeHtml(truncateName(it.product_name, 28));
                const free = it.is_free
                  ? ` <span class="t-free">OFFERT / مجاني</span>`
                  : "";
                const ar = it.product_name_ar
                  ? `<div class="t-item-ar" dir="rtl">${escapeHtml(
                      truncateName(it.product_name_ar, 28)
                    )}</div>`
                  : "";
                const opts = (it.options ?? [])
                  .map((o) => {
                    const delta = o.price_delta_da
                      ? ` (${o.price_delta_da > 0 ? "+" : ""}${formatDA(
                          o.price_delta_da
                        )})`
                      : "";
                    const arOpt = o.option_name_ar
                      ? ` / <span dir="rtl">${escapeHtml(
                          o.option_name_ar
                        )}</span>`
                      : "";
                    return `<div class="t-opt">+ ${escapeHtml(
                      o.option_name_fr
                    )}${arOpt}${escapeHtml(delta)}</div>`;
                  })
                  .join("");
                return `<div class="t-item">${qty} ${nameFr}${free}</div>${ar}${opts}`;
              })
              .join("");
            return `<div class="t-cat">${escapeHtml(
              g.title.toUpperCase()
            )} (${groupCount(g.items)})</div>${rows}`;
          })
          .join("");

  // ─── Récap ────────────────────────────────────────────────────────────
  const recapRows: string[] = [
    rowLR("Nombre de produits", String(totalUnits(order.items))),
    rowLR("Sous-total", formatDA(meta.subtotalDa)),
  ];
  if (order.service_fee_da > 0) {
    recapRows.push(rowLR(meta.feeLabel, formatDA(order.service_fee_da)));
  }
  // Réduction générique : seulement pour les anciennes commandes SANS détail
  // promo itémisé (sinon le bloc « Promotions » ci-dessous fait foi).
  if (meta.discountDa > 0 && (order.promotions?.length ?? 0) === 0) {
    const pct =
      meta.subtotalDa > 0
        ? Math.round((meta.discountDa / meta.subtotalDa) * 100)
        : 0;
    recapRows.push(
      rowLR(
        pct > 0 ? `Réduction -${pct}%` : "Réduction",
        `-${formatDA(meta.discountDa)}`
      )
    );
  }
  if (order.cashback_da > 0) {
    recapRows.push(rowLR("Cashback", `-${formatDA(order.cashback_da)}`));
  }
  recapRows.push(rowLR(meta.totalLabel, formatDA(order.total_da), true));
  if (meta.isCash) {
    recapRows.push(
      `<div class="t-p t-center">paiement en espèces ${escapeHtml(
        meta.handoffWord
      )}</div>`
    );
  }

  // ─── Promotions appliquées (résumé bilingue par type + offerts) ─────────
  const promoBlock =
    order.promotions && order.promotions.length > 0
      ? `<hr class="t-sep">
  <div class="t-h">Promotions / العروض</div>
  ${order.promotions
    .map((p) => {
      const lbl = promoTypeLabel(p.type);
      const right =
        p.free_qty > 0
          ? `${p.free_qty}× offert / مجاني`
          : `-${formatDA(p.discount_da)}`;
      const arTitle = p.title_ar
        ? ` <span dir="rtl">${escapeHtml(p.title_ar)}</span>`
        : "";
      return `<div class="t-row"><span>${escapeHtml(lbl.fr)} · ${escapeHtml(
        p.title_fr
      )}${arTitle}</span><span>${escapeHtml(right)}</span></div>`;
    })
    .join("\n  ")}`
      : "";

  // ─── Précisions particulières (note client) ─────────────────────────────
  const note = order.notes && order.notes !== "seed" ? order.notes : null;
  const noteBlock = note
    ? `<hr class="t-sep">
  <div class="t-h">Précisions particulières</div>
  <div class="t-p">${escapeHtml(note)}</div>`
    : "";

  // ─── Bloc infos client ──────────────────────────────────────────────────
  const contactPhone =
    meta.isDelivery && order.delivery_phone
      ? order.delivery_phone
      : order.customer_phone;
  const addressRow =
    meta.isDelivery && order.delivery_address
      ? `<br><b>Adresse :</b> ${escapeHtml(order.delivery_address)}`
      : "";
  const accessRow =
    meta.isDelivery && order.delivery_note
      ? `<br><b>Accès :</b> ${escapeHtml(order.delivery_note)}`
      : "";

  const copyBanner = opts.copyLabel
    ? `<div class="t-copy">${escapeHtml(opts.copyLabel)}</div>`
    : "";

  // Bandeau COMMANDE PROGRAMMÉE (très visible, en haut) — bilingue. Empêche le
  // préparateur de la lancer trop tôt.
  const scheduledBanner = order.scheduled_for
    ? `<div class="t-sched">⚠ COMMANDE PROGRAMMÉE · طلب مبرمج<div class="t-sched-time">À préparer pour / للتحضير في ${escapeHtml(
        formatScheduleClock(order.scheduled_for)
      )}</div></div>`
    : "";
  const badgeNewClient = order.is_new_customer
    ? `<div class="t-badge">NOUVEAU CLIENT</div>`
    : "";

  // ─── Styles : repris de la maquette cible (sans-serif Deliveroo) ─────────
  const styles = `
    .tk {
      color: #000; background: #fff;
      font-family: Arial, Helvetica, "Segoe UI", sans-serif;
      font-size: 15px; line-height: 1.45; font-weight: 600;
      width: 100%;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    .tk * { box-sizing: border-box; margin: 0; padding: 0; }
    .tk .t-center { text-align: center; }

    /* Copie : petit bandeau si multi-exemplaires */
    .tk .t-copy {
      text-align: center; font-weight: 800; font-size: 12px;
      letter-spacing: 2px; border: 1px solid #000; padding: 3px 0; margin-bottom: 6px;
    }

    /* En-tête : logo Coligo (image noire, texte alt en secours) + boutique */
    .tk .t-logo { text-align: center; font-size: 32px; font-weight: 900; letter-spacing: -.5px; }
    .tk .t-logo img { height: 44px; width: auto; display: inline-block; }
    .tk .t-shop { text-align: center; font-size: 15px; font-weight: 600; margin: 3px 0 10px; }

    /* Bandeau inversé mode + paiement */
    .tk .t-mode {
      text-align: center; background: #000; color: #fff; font-weight: 800;
      padding: 8px 4px; font-size: 18px; letter-spacing: .5px; margin-bottom: 6px;
      -webkit-print-color-adjust: exact; print-color-adjust: exact;
    }
    .tk .t-mode-ar { display: block; font-size: 14px; font-weight: 700; margin-top: 1px; }

    /* Bandeau COMMANDE PROGRAMMÉE — impossible à manquer (cadre épais). */
    .tk .t-sched {
      text-align: center; border: 3px solid #000; padding: 6px 4px; margin-bottom: 8px;
      font-size: 16px; font-weight: 900; letter-spacing: .3px; line-height: 1.25;
    }
    .tk .t-sched-time { font-size: 15px; font-weight: 800; margin-top: 2px; }

    /* Numéro de commande énorme, CENTRÉ (comme le QR code auparavant) */
    .tk .t-num { text-align: center; font-size: 56px; font-weight: 900; letter-spacing: -1px; line-height: 1.05; margin: 10px 0 2px; }
    /* « Livrer pour / Retrait pour » */
    .tk .t-for { text-align: center; font-size: 20px; font-weight: 800; margin: 4px 0 8px; }

    /* Séparateurs pointillés */
    .tk .t-sep { border: none; border-top: 2px dashed #000; margin: 11px 0; }

    /* Bloc précisions */
    .tk .t-h { font-size: 15px; font-weight: 800; margin-bottom: 3px; }
    .tk .t-p { font-size: 15px; font-weight: 600; line-height: 1.45; }

    /* Badge nouveau client */
    .tk .t-badge {
      text-align: center; border: 1.5px dashed #000; padding: 5px;
      font-weight: 800; font-size: 13px; margin: 8px 0; letter-spacing: .5px;
    }

    /* Articles */
    .tk .t-cat { font-size: 16px; font-weight: 800; margin: 10px 0 4px; }
    .tk .t-item { font-size: 17px; font-weight: 800; line-height: 1.4; margin: 4px 0; }
    .tk .t-item-ar { font-size: 15px; font-weight: 700; line-height: 1.4; margin: 0 0 2px; }
    .tk .t-opt { font-size: 15px; font-weight: 700; line-height: 1.5; padding-left: 10px; }
    .tk .t-free { display: inline-block; border: 1.5px solid #000; border-radius: 4px; padding: 0 4px; font-size: 12px; font-weight: 800; }

    /* Totaux : label gauche, valeur droite */
    .tk .t-row { font-size: 16px; font-weight: 700; line-height: 1.7; display: flex; justify-content: space-between; gap: 8px; }
    .tk .t-row.big { font-size: 19px; font-weight: 800; }

    /* Bloc infos client */
    .tk .t-info { font-size: 15px; font-weight: 600; line-height: 1.6; }
    .tk .t-info b { font-weight: 800; }

    /* Pied */
    .tk .t-foot { text-align: center; font-size: 15px; font-weight: 800; margin-top: 12px; letter-spacing: .3px; }

    /* QR référence commande (centré, en bas) */
    .tk .t-qr-wrap { text-align: center; margin-top: 12px; }
    .tk .t-qr { display: inline-block; width: 128px; }
    .tk .t-qr svg { width: 100%; height: auto; display: block; }
    .tk .t-qr-cap { font-size: 12px; font-weight: 700; margin-top: 3px; letter-spacing: .5px; }
    /* Fidélité client (sous le QR) */
    .tk .t-loyalty { text-align: center; margin-top: 10px; }
    .tk .t-loyalty-first { font-size: 15px; font-weight: 800; letter-spacing: .3px; }
    .tk .t-loyalty-baskets { font-size: 22px; line-height: 1.1; }
    .tk .t-loyalty-cap { font-size: 12px; font-weight: 700; margin-top: 2px; }
    /* Remerciement bas de ticket + espace au-dessus pour déchirer sans couper. */
    .tk .t-thanks-pad { height: 2.4em; }
    .tk .t-thanks { text-align: center; font-size: 15px; font-weight: 800; letter-spacing: .3px; }
    /* Marge de découpe : lignes vides en bas pour que la déchirure du ticket
       n'abîme pas le contenu (demande commerçant). */
    .tk .t-foot-pad { height: 5.6em; }
  `;

  const html = `
<div class="tk">
  ${copyBanner}
  ${scheduledBanner}

  <!-- 1. Logo + boutique (image de marque centralisée ; alt = secours texte) -->
  <div class="t-logo"><img src="${BRAND_ASSETS.print}" alt="${escapeHtml(
    opts.appName ?? "Coligo"
  )}"></div>
  <div class="t-shop">${escapeHtml(order.merchant_name)}</div>

  <!-- 2. Bandeau inversé mode + paiement -->
  <div class="t-mode">${escapeHtml(meta.bannerText)}<span class="t-mode-ar" dir="rtl">${escapeHtml(
    meta.bannerTextAr
  )}</span></div>

  <!-- 3. Numéro de commande énorme (référence publique) -->
  <div class="t-num">#${escapeHtml(orderRef(order))}</div>

  <!-- 4. Heure de retrait / livraison -->
  <div class="t-for">${escapeHtml(meta.timeLineLabel)} : ${escapeHtml(
    formatTime(order.pickup_slot_at)
  )}</div>

  ${badgeNewClient}

  <!-- 5. Précisions particulières (si note) -->
  ${noteBlock}

  <hr class="t-sep">

  <!-- 6. Articles groupés (sans prix) -->
  ${itemsHtml}

  <hr class="t-sep">

  <!-- 7. Récap + total -->
  ${recapRows.join("\n  ")}
  ${promoBlock}

  <hr class="t-sep">

  <!-- 8. Bloc infos client (adresse uniquement en livraison) -->
  <div class="t-info">
    <b>Heure commande :</b> ${escapeHtml(formatOrderClock(order.created_at))}<br>
    <b>Client :</b> ${escapeHtml(order.customer_name)}<br>
    <b>Téléphone :</b> ${escapeHtml(contactPhone)}${addressRow}${accessRow}
  </div>

  <hr class="t-sep">

  <!-- 9. Pied dépendant du mode -->
  <div class="t-foot">${escapeHtml(meta.footerText)}</div>

  <!-- 10. QR de la référence de commande (centré) -->
  <div class="t-qr-wrap">
    <div class="t-qr">${qr}</div>
    <div class="t-qr-cap">N° ${escapeHtml(orderRef(order))}</div>
  </div>
${loyaltyHtml(order)}
  <!-- Remerciement, avec de l'espace au-dessus pour déchirer sans le couper -->
  <div class="t-thanks-pad"></div>
  <div class="t-thanks">Merci pour votre confiance</div>

  <!-- Marge de découpe : lignes vides en bas -->
  <div class="t-foot-pad"></div>
</div>
<style>${styles}</style>
`;

  return { html, widthMm: w };
}
