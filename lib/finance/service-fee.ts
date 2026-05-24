// =============================================================================
// Frais de service — calcul côté serveur ET côté client (UI temps réel).
// =============================================================================
// MÊME LOGIQUE que la fonction SQL `compute_service_fee_da(products_da)`. La
// source de vérité reste le serveur (Server Action recalcule via cette
// fonction avant d'insérer la commande). Côté UI on s'en sert pour afficher
// les frais et le seuil « Gratuit dès X DA » en temps réel.
//
// Modèle : tiers triés du plus petit `upTo` au plus grand. Premier tier dont
// `upTo` > productsDa l'emporte. Au-dessus du dernier `upTo` : frais = 0.
// =============================================================================

export type ServiceFeeTier = {
  /** Borne supérieure exclusive de ce tier, en DA. */
  upTo: number;
  /** Frais à appliquer si productsDa < upTo, en DA. */
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
 * Calcule les frais de service en DA pour un total produits donné.
 *
 * @param productsDa — subtotal − discount, AVANT cashback/topup/service_fee.
 * @param tiers     — config plateforme, ou DEFAULT_SERVICE_FEE_TIERS.
 */
export function computeServiceFeeDa(
  productsDa: number,
  tiers: ServiceFeeTier[] = DEFAULT_SERVICE_FEE_TIERS
): number {
  if (!Number.isFinite(productsDa) || productsDa <= 0) return 0;
  for (const tier of tiers) {
    if (productsDa < tier.upTo) return Math.max(0, Math.round(tier.fee));
  }
  return 0;
}

/**
 * Combien manque-t-il pour atteindre la livraison gratuite ?
 * Renvoie `null` si déjà gratuit (productsDa >= dernier upTo).
 */
export function daUntilFreeServiceFee(
  productsDa: number,
  tiers: ServiceFeeTier[] = DEFAULT_SERVICE_FEE_TIERS
): number | null {
  if (tiers.length === 0) return null;
  const lastTier = tiers[tiers.length - 1];
  if (productsDa >= lastTier.upTo) return null;
  return lastTier.upTo - productsDa;
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
