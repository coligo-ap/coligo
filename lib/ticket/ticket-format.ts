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

// ===========================================================================
// Dérivation des libellés métier (mode / paiement / footer)
// ===========================================================================

export type TicketMeta = {
  isDelivery: boolean;
  isPaidOnline: boolean;
  isCash: boolean;
  /** « LIVRAISON » | « RETRAIT ». */
  modeWord: string;
  /** « PAYÉ » | « CASH ». */
  payWord: string;
  /** Bandeau inversé combiné : « LIVRAISON · PAYÉ », « RETRAIT · CASH »… */
  bannerText: string;
  /** « Livrer pour » | « Retrait pour ». */
  timeLineLabel: string;
  /** « Total » (payé/online) | « À ENCAISSER » (cash). */
  totalLabel: string;
  /** « à la livraison » | « au retrait » — mention sous le total cash. */
  handoffWord: string;
  /** Sous-total (somme des lignes). */
  subtotalDa: number;
  /** Remise éventuelle (sous-total + frais − total). */
  discountDa: number;
  /** Libellé de frais : « Frais de livraison » | « Frais de service ». */
  feeLabel: string;
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
  const payWord = isCash ? "CASH" : "PAYÉ";

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
    payWord,
    bannerText: `${modeWord} · ${payWord}`,
    timeLineLabel: isDelivery ? "Livrer pour" : "Retrait pour",
    totalLabel: isCash ? "À ENCAISSER" : "Total",
    handoffWord: isDelivery ? "à la livraison" : "au retrait",
    subtotalDa,
    discountDa,
    feeLabel: isDelivery ? "Frais de livraison" : "Frais de service",
    footerText: isDelivery
      ? "Code remis par le client au livreur (non imprimé)"
      : "Merci de votre confiance",
  };
}
