/**
 * Calcul financier LIVREUR — miroir EXACT du SQL de la migration 0103
 * (`generate_delivery_ledger_on_complete`). À utiliser côté front pour
 * afficher l'offre de course (gain net, cash à encaisser) et le relevé, et
 * côté tests. AUCUN pourcentage/durée n'est codé en dur : la config provient
 * de `platform_settings` (et `resolve_rate` pour la commission), passée en
 * argument. La source de vérité reste le trigger SQL ; ce module ne sert qu'à
 * l'affichage/estimation.
 */

export type PaymentMethod = "cash" | "online";

/** Paramètres figés dans `platform_settings` (driver_*). */
export interface DriverFeeConfig {
  driverFeeRate: number; // ex. 0.08
  driverFeeCapRate: number; // ex. 0.10
  driverFeeMinDa: number; // ex. 10
}

/** Valeurs par défaut = défauts SQL (à n'utiliser qu'en dernier recours). */
export const DEFAULT_DRIVER_FEE_CONFIG: DriverFeeConfig = {
  driverFeeRate: 0.08,
  driverFeeCapRate: 0.1,
  driverFeeMinDa: 10,
};

/**
 * Part Coligo prélevée sur la livraison D :
 *   driver_fee = max(min, min(D×rate, D×cap)), bornée par D ; 0 si D = 0.
 * (Identique au SQL : LEAST(D, GREATEST(min, LEAST(round(D×rate), round(D×cap)))).)
 */
export function computeDriverFee(
  deliveryFeeDa: number,
  cfg: DriverFeeConfig = DEFAULT_DRIVER_FEE_CONFIG
): number {
  const D = Math.max(0, Math.round(deliveryFeeDa));
  if (D <= 0) return 0;
  const byRate = Math.round(D * cfg.driverFeeRate);
  const byCap = Math.round(D * cfg.driverFeeCapRate);
  return Math.min(D, Math.max(cfg.driverFeeMinDa, Math.min(byRate, byCap)));
}

/** Gain net du livreur sur la course = D − driver_fee. */
export function computeDriverNet(
  deliveryFeeDa: number,
  cfg: DriverFeeConfig = DEFAULT_DRIVER_FEE_CONFIG
): number {
  const D = Math.max(0, Math.round(deliveryFeeDa));
  return D - computeDriverFee(D, cfg);
}

export interface OrderMoneyInput {
  /** P = produits nets après promo (net_total_da, sinon subtotal − discount). */
  productsDa: number;
  /** S = frais de service. */
  serviceFeeDa: number;
  /** D = frais de livraison. */
  deliveryFeeDa: number;
  /** total_da = ce que paie le client (P + S + D − cashback − topup). */
  totalDa: number;
  /** Taux commission résolu (commerçant ?? global). */
  commissionRate: number;
  /** Cashback réellement utilisé sur la commande (0 sur COD par défaut). */
  cashbackUsedDa?: number;
  paymentMethod: PaymentMethod;
}

export interface DriverBreakdown {
  /** Part Coligo sur la livraison. */
  driverFeeDa: number;
  /** Gain net livreur = D − driver_fee (affiché « 184 DA » dans l'offre). */
  driverNetDa: number;
  /** Avance au commerçant au retrait = P − commission (cash). */
  owesMerchantDa: number;
  /** À reverser à la plateforme = commission + S + driver_fee − cashback (cash). */
  owesPlatformDa: number;
  /** Cash à encaisser chez le client = total_da (cash). */
  cashToCollectDa: number;
  /** Commission commerçant figée. */
  commissionDa: number;
}

/**
 * Décomposition complète d'une commande livrée — miroir du trigger SQL.
 * Sur online (prépayé) : seul `driverNetDa` est dû (par la plateforme) ; les
 * champs cash sont à 0.
 */
export function computeDriverBreakdown(
  o: OrderMoneyInput,
  cfg: DriverFeeConfig = DEFAULT_DRIVER_FEE_CONFIG
): DriverBreakdown {
  const P = Math.max(0, Math.round(o.productsDa));
  const S = Math.max(0, Math.round(o.serviceFeeDa));
  const D = Math.max(0, Math.round(o.deliveryFeeDa));
  const commission = Math.round(P * o.commissionRate);
  const driverFee = computeDriverFee(D, cfg);
  const driverNet = D - driverFee;

  if (o.paymentMethod !== "cash") {
    return {
      driverFeeDa: driverFee,
      driverNetDa: driverNet,
      owesMerchantDa: 0,
      owesPlatformDa: 0,
      cashToCollectDa: 0,
      commissionDa: commission,
    };
  }

  const cashback = Math.max(0, Math.round(o.cashbackUsedDa ?? 0));
  const owesMerchant = Math.max(0, P - commission);
  const owesPlatform = Math.max(0, commission + S + driverFee - cashback);
  return {
    driverFeeDa: driverFee,
    driverNetDa: driverNet,
    owesMerchantDa: owesMerchant,
    owesPlatformDa: owesPlatform,
    cashToCollectDa: Math.round(o.totalDa),
    commissionDa: commission,
  };
}

/**
 * Sens et montant du règlement à partir des totaux d'une période.
 *  - net > 0 → la plateforme doit au livreur (virement CCP/BaridiMob).
 *  - net < 0 → le livreur doit reverser à la plateforme.
 */
export function settlementDirection(toReceiveDa: number, toReverseDa: number) {
  const net = Math.round(toReceiveDa) - Math.round(toReverseDa);
  return {
    netDa: net,
    direction: net > 0 ? "receive" : net < 0 ? "reverse" : "settled",
    amountDa: Math.abs(net),
  } as const;
}
