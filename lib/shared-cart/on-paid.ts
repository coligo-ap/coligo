import { createAdminClient } from "@/lib/supabase/admin";
import { broadcastSharedCartBump } from "@/lib/realtime/broadcast";
import { notifySharedCartPaid } from "@/lib/fcm/triggers";

// =============================================================================
// onSharedCartOrderPaid — appelé par les webhooks (Chargily + Stripe) à la
// CONFIRMATION du paiement d'une commande. Si la commande appartient à un
// panier partagé : bump temps réel de la room (payeur + capitaine + groupe
// voient « payé » instantanément) et push au capitaine avec le lien direct
// vers SA commande. No-op (une requête indexée) pour toute commande normale.
// Best-effort : ne doit JAMAIS faire échouer le webhook.
// =============================================================================

export async function onSharedCartOrderPaid(orderId: string): Promise<void> {
  try {
    const admin = createAdminClient();
    // shared_carts hors types générés → cast localisé (pattern des actions).
    const from = admin.from.bind(admin) as unknown as (t: string) => {
      select: (c: string) => {
        eq: (
          col: string,
          v: string
        ) => {
          maybeSingle: () => Promise<{
            data: {
              share_token: string;
              captain_customer_id: string;
              merchant_id: string;
            } | null;
          }>;
        };
      };
    };
    const { data: cart } = await from("shared_carts")
      .select("share_token, captain_customer_id, merchant_id")
      .eq("order_id", orderId)
      .maybeSingle();
    if (!cart) return;

    void broadcastSharedCartBump(cart.share_token);

    const { data: merchant } = await admin
      .from("merchants")
      .select("name")
      .eq("id", cart.merchant_id)
      .maybeSingle();
    void notifySharedCartPaid({
      customerId: cart.captain_customer_id,
      merchantName: merchant?.name ?? "Coligo",
      orderId,
    });
  } catch (e) {
    console.warn("[shared-cart] on-paid hook:", e);
  }
}
