import { createAdminClient } from "@/lib/supabase/admin";
import { sharedCarts } from "@/lib/shared-cart/db";

/**
 * Auto-guérison IN-BAND d'un panier partagé (appelée à l'ouverture de la room,
 * best-effort) : un panier `ordered` dont la commande liée a été ANNULÉE sans
 * paiement (échec du payeur invité, fenêtre 60 min dépassée…) repasse `locked`
 * — le capitaine reprend la main immédiatement, sans attendre le cron
 * quotidien (même logique que expire_shared_carts §c, scopée à CE panier).
 */
export async function selfHealSharedCart(shareToken: string): Promise<void> {
  try {
    const admin = createAdminClient();
    const { data: cart } = await sharedCarts(admin)
      .select("id, order_id")
      .eq("share_token", shareToken)
      .eq("status", "ordered")
      .maybeSingle<{ id: string; order_id: string | null }>();
    if (!cart?.order_id) return;

    const { data: order } = await admin
      .from("orders")
      .select("status, payment_status")
      .eq("id", cart.order_id)
      .maybeSingle();
    if (
      !order ||
      order.status !== "cancelled" ||
      order.payment_status === "paid" ||
      order.payment_status === "refunded"
    ) {
      return;
    }

    await sharedCarts(admin)
      .update({
        status: "locked",
        order_id: null,
        payment_token: null,
        payment_token_created_at: null,
        updated_at: new Date().toISOString(),
      })
      .eq("id", cart.id)
      .eq("status", "ordered");
  } catch (e) {
    console.warn("[shared-cart] selfheal:", e);
  }
}
