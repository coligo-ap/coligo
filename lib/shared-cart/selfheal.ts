import { createAdminClient } from "@/lib/supabase/admin";

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
    // Tables hors types générés → cast local du builder.
    const from = admin.from.bind(admin) as unknown as (t: string) => {
      select: (c: string) => {
        eq: (
          col: string,
          v: string
        ) => {
          eq: (
            col2: string,
            v2: string
          ) => {
            maybeSingle: () => Promise<{
              data: { id: string; order_id: string | null } | null;
            }>;
          };
        };
      };
      update: (v: Record<string, unknown>) => {
        eq: (
          col: string,
          v: string
        ) => {
          eq: (col2: string, v2: string) => Promise<{ error: unknown }>;
        };
      };
    };

    const { data: cart } = await from("shared_carts")
      .select("id, order_id")
      .eq("share_token", shareToken)
      .eq("status", "ordered")
      .maybeSingle();
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

    await from("shared_carts")
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
