// Test PUR (sans DB) — le « gains par commande » affiché au commerçant doit
// réconcilier au centime près avec les écritures wallet du trigger mig 0127.
// On réimplémente la formule du ledger ICI, indépendamment, et on vérifie que
// computeMerchantEarnings.walletImpact == SUM(écritures wallet) pour chaque cas.
//
// Exécution : node --experimental-strip-types scripts/test-order-earnings.mjs
import { computeMerchantEarnings } from "../lib/finances/order-earnings.ts";

let pass = 0,
  fail = 0;
const ok = (c, l) =>
  c ? (pass++, console.log("  ✅", l)) : (fail++, console.log("  ❌", l));

const round = (n) => Math.round(n);

// Réimplémentation INDÉPENDANTE des écritures wallet commerçant (mig 0127).
// Retourne la somme des amount_da insérés dans wallet_entries pour la commande.
function ledgerWalletImpact(o, rate, tourRate) {
  const isCash = o.payment_method === "cash";
  const isTour =
    o.fulfillment_type === "delivery" && o.delivery_mode === "tour";
  const isCodExpress =
    isCash &&
    o.fulfillment_type === "delivery" &&
    o.delivery_mode === "express" &&
    !!o.delivery_driver_id;
  if (isCodExpress) return 0; // custodian livreur (mig 0124)

  const products = Math.max(0, o.net_total_da);
  const serviceFee = o.service_fee_da ?? 0;
  const deliveryFee = o.delivery_fee_da ?? 0;
  const redeemed = (o.cashback_used_da ?? 0) + (o.topup_used_da ?? 0);
  const commission = round(products * rate);
  const tourComm =
    isTour && deliveryFee > 0 ? round(deliveryFee * tourRate) : 0;

  let sum = 0;
  if (!isCash) sum += products; // 'sale'
  sum += -commission; // 'commission'
  if (isCash && serviceFee > 0) sum += -serviceFee; // 'service_fee'
  if (isCash && redeemed > 0) sum += redeemed; // 'wallet_redemption'
  if (isTour) {
    if (!isCash && deliveryFee > 0) sum += deliveryFee; // 'delivery_revenue'
    if (tourComm > 0) sum += -tourComm; // 'tour_delivery_commission'
  }
  return sum;
}

const RATE = 0.1; // 10 % commission produits
const TOUR = 0.2; // 20 % commission livraison tournée

// Chaque cas est FINALISÉ (commission_da figée) pour comparer à la formule.
function finalize(o) {
  const products = Math.max(0, o.net_total_da);
  const isTour =
    o.fulfillment_type === "delivery" && o.delivery_mode === "tour";
  return {
    ...o,
    status: o.payment_method === "cash" ? "completed" : o.status,
    payment_status: o.payment_method === "online" ? "paid" : o.payment_status,
    commission_da: round(products * RATE),
    commission_rate_applied: RATE,
    tour_delivery_commission_da:
      isTour && (o.delivery_fee_da ?? 0) > 0
        ? round((o.delivery_fee_da ?? 0) * TOUR)
        : 0,
  };
}

const cases = [
  {
    name: "Retrait CASH simple",
    o: {
      payment_method: "cash",
      total_da: 1100,
      net_total_da: 1000,
      service_fee_da: 100,
      fulfillment_type: "pickup",
    },
  },
  {
    name: "Retrait CASH avec cashback + Coligo Pay partiels",
    o: {
      payment_method: "cash",
      total_da: 1100,
      net_total_da: 1000,
      service_fee_da: 100,
      cashback_used_da: 150,
      topup_used_da: 50,
      fulfillment_type: "pickup",
    },
  },
  {
    name: "Retrait EN LIGNE simple",
    o: {
      payment_method: "online",
      total_da: 1100,
      net_total_da: 1000,
      service_fee_da: 100,
      fulfillment_type: "pickup",
    },
  },
  {
    name: "Tournée EN LIGNE (revenu livraison + commission tournée)",
    o: {
      payment_method: "online",
      total_da: 1400,
      net_total_da: 1000,
      service_fee_da: 100,
      delivery_fee_da: 300,
      fulfillment_type: "delivery",
      delivery_mode: "tour",
    },
  },
  {
    name: "COD EXPRESS (réglé via le livreur → 0 wallet)",
    o: {
      payment_method: "cash",
      total_da: 1300,
      net_total_da: 1000,
      service_fee_da: 100,
      delivery_fee_da: 200,
      fulfillment_type: "delivery",
      delivery_mode: "express",
      delivery_driver_id: "drv-1",
    },
  },
];

console.log("→ Réconciliation walletImpact vs ledger 0127");
for (const { name, o } of cases) {
  const fin = finalize(o);
  const e = computeMerchantEarnings(fin, {
    commissionRate: RATE,
    tourRate: TOUR,
  });
  const expected = ledgerWalletImpact(fin, RATE, TOUR);
  ok(
    e.walletImpact === expected,
    `${name} — wallet ${e.walletImpact} = ${expected}`
  );
}

// Invariants métier supplémentaires.
console.log("→ Invariants");
// Fixture RÉALISTE : le checkout calcule total = produits + frais − wallets
// dépensés → total_da est DÉJÀ net du cashback (audit A1 du 04/07/2026 :
// ne JAMAIS re-soustraire redeemed des espèces en main).
const cash = computeMerchantEarnings(
  finalize({
    payment_method: "cash",
    total_da: 900,
    net_total_da: 1000,
    service_fee_da: 100,
    cashback_used_da: 200,
    fulfillment_type: "pickup",
  }),
  { commissionRate: RATE }
);
ok(
  cash.cashCollected === 900,
  "Espèces en main = total_da (déjà net du wallet dépensé) = 900"
);
ok(
  cash.owedToColigo === 200,
  "À régler Coligo = commission + frais service (100+100)"
);
ok(cash.net === 900, "Marge nette cash = produits − commission (1000−100)");
ok(cash.redeemed === 200, "Reversement wallet client = 200");

// Estimation : commande NON finalisée → commission estimée via le taux, jamais le total.
const pending = computeMerchantEarnings(
  {
    payment_method: "online",
    payment_status: "pending",
    total_da: 1100,
    net_total_da: 1000,
    service_fee_da: 100,
    fulfillment_type: "pickup",
  },
  { commissionRate: RATE }
);
ok(!pending.finalized, "Commande en ligne non payée = non finalisée");
ok(
  pending.commission === 100,
  "Commission estimée = produits × taux (pas le total)"
);
ok(
  pending.walletImpact === 900,
  "Wallet estimé = produits − commission (1000−100)"
);

console.log(`\n${pass} ✅  ${fail} ❌`);
process.exit(fail ? 1 : 0);
