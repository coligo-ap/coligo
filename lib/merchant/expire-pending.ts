import type { createClient } from "@/lib/supabase/server";
import { notifyCustomerStatusChange } from "@/lib/fcm/triggers";

/**
 * Délai (minutes) au-delà duquel une commande NON acceptée est refusée
 * automatiquement. Doit rester cohérent avec le compte-à-rebours affiché
 * côté commerçant (`NewOrderOverlay` → AUTO_REFUSE_SECONDS = 15 min).
 */
const EXPIRY_MINUTES = 15;

const AUTO_REFUSE_NOTE = "Refus automatique : non acceptée sous 15 min";

/**
 * Expiration « paresseuse » des commandes à confirmer (pas de cron — cohérent
 * avec l'approche Express timing du projet).
 *
 * Appelée à chaque accès à la coque commerçant (`MerchantShell`). Toute
 * commande restée `pending` plus de 15 min est passée en `cancelled`, audit
 * écrit dans `order_events` et le client notifié. La RLS garantit qu'on ne
 * touche QUE les commandes du commerçant connecté.
 *
 * Robustesse vs minuterie client : même si le commerçant ferme l'app, la
 * commande sera refusée dès le prochain chargement d'une page commerçant
 * (par lui ou par le rafraîchissement périodique du pont Realtime). Le client,
 * lui, voit le refus via le push FCM.
 *
 * Idempotent et anti-course : le `update … .eq('status','pending')` ne
 * recouvre pas une commande acceptée entre-temps, et `.select()` ne renvoie
 * que les lignes RÉELLEMENT basculées → audit/push exacts.
 */
export async function expireStalePendingOrders(
  supabase: Awaited<ReturnType<typeof createClient>>
): Promise<void> {
  const cutoff = new Date(Date.now() - EXPIRY_MINUTES * 60_000).toISOString();

  // Repère d'abord les candidates (léger ; index status/created_at).
  const { data: stale, error: readError } = await supabase
    .from("orders")
    .select("id")
    .eq("status", "pending")
    .lt("created_at", cutoff);

  if (readError || !stale || stale.length === 0) return;
  const ids = stale.map((o) => o.id);

  // Bascule atomique. `.eq('status','pending')` = garde anti-course ;
  // `.select('id')` = ne renvoie que ce qui a effectivement changé.
  const { data: cancelled, error: updateError } = await supabase
    .from("orders")
    .update({ status: "cancelled" })
    .in("id", ids)
    .eq("status", "pending")
    .select("id");

  if (updateError || !cancelled || cancelled.length === 0) return;
  const cancelledIds = cancelled.map((o) => o.id);

  // Audit append-only (une erreur ici ne doit pas casser le rendu de page).
  await supabase.from("order_events").insert(
    cancelledIds.map((id) => ({
      order_id: id,
      from_status: "pending",
      to_status: "cancelled",
      note: AUTO_REFUSE_NOTE,
    }))
  );

  // Push FCM au client — fire-and-forget, pas de blocage du rendu.
  for (const id of cancelledIds) {
    void notifyCustomerStatusChange({ orderId: id, newStatus: "cancelled" });
  }
}
