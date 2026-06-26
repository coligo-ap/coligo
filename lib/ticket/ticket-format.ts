/**
 * Source UNIQUE de configuration et de formatage du ticket de commande.
 *
 * Les DEUX builders (`build-ticket-sunmi.ts` pour le thermique natif ESC/POS,
 * `build-ticket-html.ts` pour l'aperçu écran + impression navigateur) importent
 * d'ici. Objectif : zéro duplication des règles de mise en page et des libellés
 * métier — le ticket imprimé (Sunmi) et l'aperçu écran restent toujours
 * cohérents (cf. maquette `apercu-ticket-deliveroo.html`, style Deliveroo 50 mm).
 *
 * Ne contient AUCUNE logique de rendu : juste des constantes de laize, des
 * formatters et la dérivation des libellés (mode / paiement / footer).
 */

import type { PrintWidth } from "@/lib/types";
import type { TicketItem, TicketOrder } from "@/lib/ticket/build-ticket-html";

/**
 * Caractères par ligne en police par défaut (Font A, 12 dots/car) selon la
 * laize papier, à 8 dots/mm :
 *   - 50 mm (Sunmi V3, rouleau intégré) → ~384 dots imprimables → 32 car.
 *   - 58 mm (Sunmi V2)                  → ~384 dots             → 32 car.
 *   - 80 mm (imprimante comptoir)       → ~576 dots             → 48 car.
 * Le double-width (textBoldStrong) = 24 dots/car → moitié (16 ou 24 car.).
 */
export function columnsForWidth(width: PrintWidth): number {
  return width === 80 ? 48 : 32;
}

/**
 * Tailles texte Sunmi (firmware V3 = {16, 24, 28, 32, 48} autorisées).
 * En pratique le firmware IGNORE setFontSize pour printColumnsText : la
 * hiérarchie passe par l'emphase (gras) et le double-width (textBoldStrong).
 * On conserve ces valeurs pour la sémantique + un éventuel printTextWithFont.
 *   small = méta / mentions ; base = corps ; large = #commande / heure.
 */
export const SUNMI_SIZE = {
  small: 16,
  base: 24,
  large: 32,
} as const;

/** Interligne thermique (dots). ≈ 0.75 mm — aéré sans coller les lignes. */
export const SUNMI_LINE_SPACING = 6;

// ===========================================================================
// Formatters (identiques côté thermique et HTML)
// ===========================================================================

export function formatDA(amountDa: number): string {
  return (
    new Intl.NumberFormat("fr-DZ", { maximumFractionDigits: 0 }).format(
      Math.round(amountDa)
    ) + " DA"
  );
}

/** « 13:35 » — heure du créneau retrait / livraison. */
export function formatTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("fr-DZ", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * « 13:14, 31 mai » — horodatage de la commande (bloc infos bas de ticket),
 * calé sur la maquette Deliveroo.
 */
export function formatOrderClock(iso: string): string {
  const d = new Date(iso);
  const time = d.toLocaleTimeString("fr-DZ", {
    hour: "2-digit",
    minute: "2-digit",
  });
  const date = d.toLocaleDateString("fr-DZ", {
    day: "numeric",
    month: "long",
  });
  return `${time}, ${date}`;
}

export function shortId(id: string): string {
  return id.slice(0, 6).toUpperCase();
}

/** Référence publique imprimée (#A042). JAMAIS le pickup_code (PIN secret). */
export function orderRef(order: TicketOrder): string {
  return order.order_number ?? shortId(order.id);
}

// ===========================================================================
// Articles
// ===========================================================================

/** Nombre total d'unités d'une commande (somme des quantités). */
export function totalUnits(items: TicketItem[]): number {
  return items.reduce((s, it) => s + Number(it.quantity || 0), 0);
}

/** Nombre d'unités d'un groupe. */
export function groupCount(items: TicketItem[]): number {
  return items.reduce((s, it) => s + Number(it.quantity || 0), 0);
}

/**
 * Regroupe par catégorie, ordre = première apparition. Items sans catégorie
 * → groupe « Articles ».
 */
export function groupByCategory(
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

/** Abréviation d'unité de vente pour le ticket (vrac). */
const UNIT_SHORT: Record<string, string> = {
  kg: "kg",
  l: "L",
  m: "m",
  custom: "",
};

/**
 * Préfixe quantité d'une ligne : « 3× » à la pièce, « 0,75 kg » en vrac
 * (virgule décimale FR, zéros superflus retirés par JS). Universel FR/AR.
 */
export function formatQtyUnit(quantity: number, unit?: string | null): string {
  const q = String(quantity).replace(".", ",");
  if (!unit || unit === "piece") return `${q}×`;
  const short = UNIT_SHORT[unit] ?? unit;
  return short ? `${q} ${short}` : `${q}`;
}

/**
 * Troncature intelligente d'un nom long : coupe sur un mot si la coupure tombe
 * assez loin, sinon coupe net, et ajoute « … ». Évite les noms qui débordent
 * sur un ticket étroit (32/48 colonnes).
 */
export function truncateName(name: string, max: number): string {
  const s = (name ?? "").trim();
  if (s.length <= max) return s;
  const cut = s.slice(0, max - 1);
  const lastSpace = cut.lastIndexOf(" ");
  const base = lastSpace > max * 0.6 ? cut.slice(0, lastSpace) : cut;
  return base.trimEnd() + "…";
}

/** Libellé bilingue du type de promotion (pour le résumé du ticket). */
export function promoTypeLabel(type: string): { fr: string; ar: string } {
  switch (type) {
    case "product_discount":
      return { fr: "Réduction", ar: "تخفيض" };
    case "quantity_offer":
      return { fr: "Offre quantité", ar: "عرض الكمية" };
    case "promo_code":
      return { fr: "Code promo", ar: "رمز ترويجي" };
    default:
      return { fr: "Promotion", ar: "ترويج" };
  }
}

// ===========================================================================
// Dérivation des libellés métier (mode / paiement / footer)
// ===========================================================================

export type TicketMeta = {
  isDelivery: boolean;
  isPaidOnline: boolean;
  isCash: boolean;
  /** « LIVRAISON » | « RETRAIT ». */
  modeWord: string;
  /** Variante AR : « توصيل » | « استلام ». */
  modeWordAr: string;
  /** « PAYÉ » | « CASH ». */
  payWord: string;
  /** Variante AR : « مدفوع » | « نقدا ». */
  payWordAr: string;
  /** Bandeau inversé FR : « LIVRAISON · PAYÉ » (ASCII-safe pour Sunmi). */
  bannerText: string;
  /** Bandeau inversé AR : « توصيل · مدفوع » (rendu HTML/canvas seulement). */
  bannerTextAr: string;
  /** « Livrer pour » | « Retrait pour ». */
  timeLineLabel: string;
  /** Variante AR : « التوصيل في » | « الاستلام في ». */
  timeLineLabelAr: string;
  /** « Total » (payé/online) | « À ENCAISSER » (cash). */
  totalLabel: string;
  /** Variante AR : « المجموع » | « للتحصيل ». */
  totalLabelAr: string;
  /** « à la livraison » | « au retrait » — mention sous le total cash. */
  handoffWord: string;
  /** Sous-total (somme des lignes). */
  subtotalDa: number;
  /** Remise éventuelle (sous-total + frais − total). */
  discountDa: number;
  /** Libellé de frais : « Frais de livraison » | « Frais de service ». */
  feeLabel: string;
  /** Variante AR du libellé de frais. */
  feeLabelAr: string;
  /** Pied de ticket dépendant du mode. */
  footerText: string;
};

/**
 * Calcule, à UN SEUL endroit, tous les libellés et montants dérivés du mode de
 * service et du paiement. Les deux builders consomment ce résultat → un seul
 * point de vérité, aucune divergence possible entre l'aperçu et l'impression.
 */
export function deriveTicketMeta(order: TicketOrder): TicketMeta {
  const isDelivery = order.fulfillment_type === "delivery";
  const isPaidOnline =
    order.payment_method === "online" && order.payment_status === "paid";
  const isCash = order.payment_method === "cash";

  const modeWord = isDelivery ? "LIVRAISON" : "RETRAIT";
  const modeWordAr = isDelivery ? "توصيل" : "استلام";
  const payWord = isCash ? "CASH" : "PAYÉ";
  const payWordAr = isCash ? "نقدا" : "مدفوع";

  const subtotalDa = order.items.reduce((s, it) => s + it.line_total_da, 0);
  const discountDa = Math.max(
    0,
    subtotalDa + order.service_fee_da - order.total_da
  );

  return {
    isDelivery,
    isPaidOnline,
    isCash,
    modeWord,
    modeWordAr,
    payWord,
    payWordAr,
    // Bandeau : FR (ASCII-safe Sunmi) + variante AR séparée (HTML/canvas).
    bannerText: `${modeWord} · ${payWord}`,
    bannerTextAr: `${modeWordAr} · ${payWordAr}`,
    timeLineLabel: isDelivery ? "Livrer pour" : "Retrait pour",
    timeLineLabelAr: isDelivery ? "التوصيل في" : "الاستلام في",
    totalLabel: isCash ? "À ENCAISSER" : "Total",
    totalLabelAr: isCash ? "للتحصيل" : "المجموع",
    handoffWord: isDelivery ? "à la livraison" : "au retrait",
    subtotalDa,
    discountDa,
    feeLabel: isDelivery ? "Frais de livraison" : "Frais de service",
    feeLabelAr: isDelivery ? "رسوم التوصيل" : "رسوم الخدمة",
    footerText: isDelivery
      ? "Code remis par le client au livreur (non imprimé)"
      : "Merci pour votre confiance !",
  };
}

/**
 * Fidélité client : à partir du nombre TOTAL de commandes de ce client chez CE
 * commerçant (commandes passées + la courante, déjà insérée). `null`/0 →
 * inconnu (rien à imprimer, ex. client sans téléphone).
 *   1   → première commande
 *   ≥ 2 → client récurrent (le builder affiche des paniers / le rang).
 */
export function loyaltyInfo(
  count?: number | null
): { first: boolean; count: number } | null {
  if (count == null || count < 1) return null;
  return { first: count === 1, count };
}

/** Ordinal français court : 1 → « 1re », n → « ne » (2e, 3e…). */
export function ordinalFr(n: number): string {
  return n === 1 ? "1re" : `${n}e`;
}
