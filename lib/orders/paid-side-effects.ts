import { notifyMerchantNewOrder, notifyDriversTour } from "@/lib/fcm/triggers";
import { onSharedCartOrderPaid } from "@/lib/shared-cart/on-paid";

// =============================================================================
// runOrderPaidSideEffects — effets visibles utilisateur après la transition
// pending→paid d'une commande online, PARTAGÉS par les trois branches webhook
// (Chargily, Stripe intent, Stripe session) : push commerçant, livreurs de
// tournée, panier partagé (bump room + push capitaine). Le prochain effet
// s'ajoute ICI, une seule fois.
//
// ATTENDU par l'appelant — en serverless, un `void` peut être gelé dès la
// réponse rendue : push capitaine / cloche silencieusement perdus. Chaque
// effet est déjà best-effort (try/catch interne) ; le filet .catch garantit
// qu'aucun rejet ne fait échouer le webhook.
// =============================================================================

const settle = (p: Promise<unknown>) =>
  p.catch((e) => console.warn("[order-paid] side effect:", e));

export async function runOrderPaidSideEffects(updated: {
  id: string;
  merchant_id: string;
  customer_name: string | null;
  total_da: number;
}): Promise<void> {
  await Promise.all([
    settle(
      notifyMerchantNewOrder({
        merchantId: updated.merchant_id,
        orderId: updated.id,
        customerName: updated.customer_name,
        totalDa: updated.total_da,
      })
    ),
    settle(notifyDriversTour({ orderId: updated.id })),
    settle(onSharedCartOrderPaid(updated.id)),
  ]);
}
