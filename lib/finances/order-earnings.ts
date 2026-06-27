// =============================================================================
// Gains commerçant PAR COMMANDE — fonction PURE, miroir du trigger mig 0127.
// =============================================================================
// But : afficher au commerçant ce qu'il gagne RÉELLEMENT sur une commande, avec
// un chiffre qui réconcilie au centime près avec son /finances (le ledger).
//
// Rappel du modèle (cf. [[project_billing_payouts_model]] / mig 0127) :
//   products      = net_total_da (= subtotal − discount) → CA du commerçant
//   commission    = products × taux           → part Coligo (prélevée)
//   service_fee   = 100 % plateforme, PAYÉ PAR LE CLIENT (dette si cash)
//   delivery_fee  = au livreur (sauf tournée EN LIGNE = revenu commerçant)
//   redeemed      = cashback + Coligo Pay du client → reversé au commerçant (cash)
//
// Écritures wallet par commande (= ce qui touche le solde Coligo Pay) :
//   ONLINE        : +products −commission  (+deliveryFee −tourComm si tournée)
//   CASH          : −commission −serviceFee +redeemed  (−tourComm si tournée)
//   COD EXPRESS   : 0 ici (le livreur est custodian — delivery_ledger / mig 0124)
// =============================================================================

export type OrderEarningsInput = {
  payment_method: "cash" | "online";
  payment_status?: string | null;
  status?: string | null;
  total_da: number;
  net_total_da?: number | null;
  subtotal_da?: number | null;
  discount_da?: number | null;
  service_fee_da?: number | null;
  delivery_fee_da?: number | null;
  /** Figé à la finalisation (sinon 0/null → on estime via le taux). */
  commission_da?: number | null;
  commission_rate_applied?: number | null;
  tour_delivery_commission_da?: number | null;
  cashback_used_da?: number | null;
  topup_used_da?: number | null;
  fulfillment_type?: "pickup" | "delivery" | null;
  delivery_mode?: "express" | "tour" | null;
  delivery_driver_id?: string | null;
};

export type MerchantOrderEarnings = {
  /** Commission figée (commande finalisée) ou estimée via le taux. */
  finalized: boolean;
  paymentMethod: "cash" | "online";
  isTour: boolean;
  /** Livraison express payée cash → réglée via le livreur, pas via le wallet. */
  isCodExpress: boolean;

  products: number;
  commission: number;
  serviceFee: number;
  deliveryFee: number;
  tourCommission: number;
  redeemed: number;

  /** Marge nette sur la commande (le « vous gagnez » mis en avant). */
  net: number;
  /** Mouvement EXACT sur le solde Coligo Pay (réconcilie avec /finances). */
  walletImpact: number;
  /** Espèces réellement remises en main par le client (cash uniquement). */
  cashCollected: number | null;
  /** À régler à Coligo sur les ventes espèces (cash uniquement). */
  owedToColigo: number | null;
};

const r = (n: number) => Math.round(n);

/**
 * @param o        La commande (champs financiers).
 * @param fallback Taux de commission produits à utiliser si la commande n'est
 *                 pas encore finalisée (typiquement merchant.commission_rate).
 */
export function computeMerchantEarnings(
  o: OrderEarningsInput,
  fallback: { commissionRate?: number; tourRate?: number } = {}
): MerchantOrderEarnings {
  const isCash = o.payment_method === "cash";
  const isTour =
    o.fulfillment_type === "delivery" && o.delivery_mode === "tour";
  const isCodExpress =
    isCash &&
    o.fulfillment_type === "delivery" &&
    o.delivery_mode === "express" &&
    !!o.delivery_driver_id;

  const finalized = isCash
    ? o.status === "completed"
    : o.payment_status === "paid";

  const products = Math.max(
    0,
    o.net_total_da ?? (o.subtotal_da ?? 0) - (o.discount_da ?? 0)
  );
  const serviceFee = Math.max(0, o.service_fee_da ?? 0);
  const deliveryFee = Math.max(0, o.delivery_fee_da ?? 0);
  const redeemed = Math.max(
    0,
    (o.cashback_used_da ?? 0) + (o.topup_used_da ?? 0)
  );

  // Commission : valeur figée si finalisée, sinon estimation via le taux.
  const rate = o.commission_rate_applied ?? fallback.commissionRate ?? 0;
  const commission =
    finalized && o.commission_da != null && o.commission_da > 0
      ? o.commission_da
      : r(products * rate);

  // Commission livraison tournée : idem (figée si dispo, sinon estimée).
  let tourCommission = 0;
  if (isTour && deliveryFee > 0) {
    tourCommission =
      finalized && o.tour_delivery_commission_da != null
        ? o.tour_delivery_commission_da
        : r(deliveryFee * (fallback.tourRate ?? 0));
  }

  // Marge nette « biens » : revenu produits − commission ; en tournée EN LIGNE
  // le commerçant encaisse aussi la livraison (− sa commission tournée).
  const tourOnlineRevenue = !isCash && isTour ? deliveryFee : 0;
  const net = products - commission - tourCommission + tourOnlineRevenue;

  // Mouvement EXACT sur le solde Coligo Pay (miroir mig 0127).
  let walletImpact: number;
  let cashCollected: number | null = null;
  let owedToColigo: number | null = null;
  if (isCodExpress) {
    walletImpact = 0; // réglé via le livreur (custodian)
  } else if (isCash) {
    walletImpact = -commission - serviceFee + redeemed - tourCommission;
    cashCollected = Math.max(0, o.total_da - redeemed);
    owedToColigo = commission + serviceFee + tourCommission;
  } else {
    walletImpact = products - commission + tourOnlineRevenue - tourCommission;
  }

  return {
    finalized,
    paymentMethod: o.payment_method,
    isTour,
    isCodExpress,
    products,
    commission,
    serviceFee,
    deliveryFee,
    tourCommission,
    redeemed,
    net,
    walletImpact,
    cashCollected,
    owedToColigo,
  };
}
