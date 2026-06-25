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
 *
 * À nourrir avec le panier BRUT (avant promotions) — cf. `resolveServiceFeeDa`.
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

// =============================================================================
// Garde-fou anti-abus — éligibilité sur le BRUT, frais minimum sur le NET.
// =============================================================================
// L'éligibilité aux paliers (et à la gratuité) se calcule sur le panier BRUT
// (AVANT promotions) : plus simple à comprendre, meilleure UX — un panier de
// 3 000 DA reste exonéré de frais de service même après une grosse promo.
//
// MAIS si le montant NET réellement à payer (APRÈS promotions) tombe très bas
// (p. ex. 100 DA), une promo très agressive ne doit pas faire travailler la
// plateforme à perte : on garantit alors un frais de service minimum couvrant
// les coûts opérationnels. (Valeurs ajustables ; centralisables plus tard dans
// platform_settings si besoin de pilotage admin.)
// =============================================================================

/** Net (après promos) en-dessous duquel le frais minimum s'applique. */
export const DEFAULT_MIN_NET_FOR_FREE_DA = 200;
/** Frais de service minimum garanti quand le net est anormalement bas. */
export const DEFAULT_MIN_SERVICE_FEE_DA = 20;

export type ResolveServiceFeeArgs = {
  /** Panier BRUT, avant promotions — détermine le palier / la gratuité. */
  grossProductsDa: number;
  /** Montant NET à payer, après promotions — déclenche le garde-fou. */
  netProductsDa: number;
  tiers?: ServiceFeeTier[];
  /** Seuil de net sous lequel le frais minimum s'applique. */
  minNetForFeeDa?: number;
  /** Frais de service minimum garanti. */
  minServiceFeeDa?: number;
};

/**
 * Frais de service final :
 *   - palier calculé sur le BRUT (avant promos) → conserve la gratuité ;
 *   - garde-fou « frais minimum » si le NET (après promos) devient très faible.
 */
export function resolveServiceFeeDa({
  grossProductsDa,
  netProductsDa,
  tiers = DEFAULT_SERVICE_FEE_TIERS,
  minNetForFeeDa = DEFAULT_MIN_NET_FOR_FREE_DA,
  minServiceFeeDa = DEFAULT_MIN_SERVICE_FEE_DA,
}: ResolveServiceFeeArgs): number {
  const fee = computeServiceFeeDa(grossProductsDa, tiers);
  // Net anormalement bas après une grosse promo → frais minimum garanti.
  if (netProductsDa > 0 && netProductsDa < minNetForFeeDa) {
    return Math.max(fee, Math.max(0, Math.round(minServiceFeeDa)));
  }
  return fee;
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
