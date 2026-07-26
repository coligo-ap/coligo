import { createAdminClient } from "@/lib/supabase/admin";
import { broadcastSharedCartBump } from "@/lib/realtime/broadcast";
import { notifySharedCartPaid } from "@/lib/fcm/triggers";
import { sharedCarts } from "@/lib/shared-cart/db";

// =============================================================================
// onSharedCartOrderPaid — appelé par les webhooks (Chargily + Stripe) à la
// CONFIRMATION du paiement d'une commande. Si la commande appartient à un
// panier partagé : bump temps réel de la room (payeur + capitaine + groupe
// voient « payé » instantanément) et push au capitaine avec le lien direct
// vers SA commande. No-op (une requête indexée) pour toute commande normale.
// Best-effort : ne doit JAMAIS faire échouer le webhook. Les effets sont
// ATTENDUS (pas de `void`) : en serverless, une promesse orpheline peut être
// gelée avec la réponse déjà rendue → bump/push perdus sans trace.
// =============================================================================

export async function onSharedCartOrderPaid(orderId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: cart } = await sharedCarts(admin)
      .select("share_token, captain_customer_id, merchant_id")
      .eq("order_id", orderId)
      .maybeSingle<{
        share_token: string;
        captain_customer_id: string;
        merchant_id: string;
      }>();
    if (!cart) return;

    const { data: merchant } = await admin
      .from("merchants")
      .select("name")
      .eq("id", cart.merchant_id)
      .maybeSingle();
    await Promise.all([
      broadcastSharedCartBump(cart.share_token),
      notifySharedCartPaid({
        customerId: cart.captain_customer_id,
        merchantName: merchant?.name ?? "Coligo",
        orderId,
      }),
    ]);
  } catch (e) {
    console.warn("[shared-cart] on-paid hook:", e);
  }
}
