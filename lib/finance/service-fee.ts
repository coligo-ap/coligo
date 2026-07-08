// =============================================================================
// Frais de service — calcul côté serveur ET côté client (UI temps réel).
// =============================================================================
// RÈGLE PRODUIT (08/07/2026) : les frais de service se calculent sur ce que le
// client PAIE RÉELLEMENT pour ses produits — le panier NET après promotions
// commerçant (réductions, offres « X achetés = Y offert ») ET après code promo
// plateforme. Ni le cashback ni le solde Coligo Pay n'entrent dans l'assiette
// (ce sont des moyens de paiement, pas des remises).
//
// ANTI-FRAUDE : la SOURCE DE VÉRITÉ est le serveur. La Server Action
// `createOrder` recalcule prix produits (DB), promotions, code promo et frais
// via cette même fonction avant d'insérer la commande — toute valeur affichée
// ou envoyée par le navigateur est ignorée. Le montant est figé dans
// `orders.service_fee_da` puis rendu immuable par le trigger
// `protect_order_financial_fields` (mig 0166). Côté UI on réutilise cette
// fonction uniquement pour AFFICHER le même résultat en temps réel.
//
// Modèle : tiers triés du plus petit `upTo` au plus grand. Premier tier dont
// `upTo` > netPayableDa l'emporte. Au-dessus du dernier `upTo` : frais = 0.
// (Un panier rendu très petit par une grosse promo retombe naturellement dans
// le premier palier payant — plus besoin de garde-fou séparé.)
// =============================================================================

export type ServiceFeeTier = {
  /** Borne supérieure exclusive de ce tier, en DA. */
  upTo: number;
  /** Frais à appliquer si netPayableDa < upTo, en DA. */
  fee: number;
};

/**
 * Tiers par défaut — alignés sur les paniers moyens algériens (cf. étude
 * pouvoir d'achat). Identiques à la valeur DEFAULT côté SQL.
 */
export const DEFAULT_SERVICE_FEE_TIERS: ServiceFeeTier[] = [
  { upTo: 200, fee: 30 },
  { upTo: 500, fee: 20 },
  { upTo: 1000, fee: 10 },
];

/**
 * Calcule les frais de service en DA sur le montant produits RÉELLEMENT payé.
 *
 * @param netPayableDa — produits APRÈS promotions commerçant ET code promo
 *                       plateforme (AVANT cashback/topup, qui sont des moyens
 *                       de paiement).
 * @param tiers        — config plateforme, ou DEFAULT_SERVICE_FEE_TIERS.
 */
export function computeServiceFeeDa(
  netPayableDa: number,
  tiers: ServiceFeeTier[] = DEFAULT_SERVICE_FEE_TIERS
): number {
  if (!Number.isFinite(netPayableDa) || netPayableDa <= 0) return 0;
  for (const tier of tiers) {
    if (netPayableDa < tier.upTo) return Math.max(0, Math.round(tier.fee));
  }
  return 0;
}

/**
 * Combien manque-t-il pour atteindre la gratuité des frais ?
 * Renvoie `null` si déjà gratuit (netPayableDa >= dernier upTo).
 *
 * À nourrir avec la MÊME assiette que `computeServiceFeeDa` (net réellement
 * payé) pour que la jauge « gratuit dès X DA » soit cohérente avec le frais.
 */
export function daUntilFreeServiceFee(
  netPayableDa: number,
  tiers: ServiceFeeTier[] = DEFAULT_SERVICE_FEE_TIERS
): number | null {
  if (tiers.length === 0) return null;
  const lastTier = tiers[tiers.length - 1];
  if (netPayableDa >= lastTier.upTo) return null;
  return lastTier.upTo - netPayableDa;
}

/**
 * Parse défensif : la valeur SQL `platform_settings.service_fee_tiers` est en
 * JSONB. On accepte aussi un Array natif (cas où Supabase l'a déjà parsé).
 * Si le format n'est pas reconnaissable, on tombe sur DEFAULT.
 */
export function parseTiers(raw: unknown): ServiceFeeTier[] {
  if (!Array.isArray(raw)) return DEFAULT_SERVICE_FEE_TIERS;
  const parsed: ServiceFeeTier[] = [];
  for (const item of raw) {
    if (
      item &&
      typeof item === "object" &&
      typeof (item as Record<string, unknown>).up_to === "number" &&
      typeof (item as Record<string, unknown>).fee === "number"
    ) {
      const obj = item as { up_to: number; fee: number };
      parsed.push({ upTo: obj.up_to, fee: obj.fee });
    } else if (
      item &&
      typeof item === "object" &&
      typeof (item as Record<string, unknown>).upTo === "number" &&
      typeof (item as Record<string, unknown>).fee === "number"
    ) {
      const obj = item as { upTo: number; fee: number };
      parsed.push({ upTo: obj.upTo, fee: obj.fee });
    }
  }
  if (parsed.length === 0) return DEFAULT_SERVICE_FEE_TIERS;
  parsed.sort((a, b) => a.upTo - b.upTo);
  return parsed;
}
