"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isValidTransition, type OrderStatus } from "@/lib/types";

export type OrderActionResult = {
  error?: string;
  success?: string;
};

/**
 * Fait avancer une commande dans son cycle de vie.
 *
 * - Vérifie que la transition est autorisée (sinon refus).
 * - La RLS garantit que la commande appartient au commerçant connecté.
 * - Idempotency : si un `clientOperationId` déjà traité est rejoué, on ne
 *   réapplique pas (la même opération ne produit qu'un seul changement).
 * - Audit : écrit une ligne dans `order_events` à chaque changement.
 */
export async function updateOrderStatus(
  orderId: string,
  to: OrderStatus,
  clientOperationId?: string
): Promise<OrderActionResult> {
  const supabase = await createClient();

  // Idempotency : opération déjà appliquée ?
  if (clientOperationId) {
    const { data: existing } = await supabase
      .from("order_events")
      .select("id")
      .eq("client_operation_id", clientOperationId)
      .maybeSingle();
    if (existing) return { success: "Déjà appliqué." };
  }

  // RLS : ne renvoie la commande que si elle appartient au commerçant.
  const { data: order, error: readError } = await supabase
    .from("orders")
    .select("id, status")
    .eq("id", orderId)
    .maybeSingle();

  if (readError) return { error: `Erreur : ${readError.message}` };
  if (!order) return { error: "Commande introuvable." };

  const from = order.status as OrderStatus;
  if (from === to) return { success: "Aucun changement." };
  if (!isValidTransition(from, to)) {
    return { error: `Transition non autorisée (${from} → ${to}).` };
  }

  const { error: updateError } = await supabase
    .from("orders")
    .update({ status: to })
    .eq("id", orderId);

  if (updateError) {
    return { error: `Erreur lors de la mise à jour : ${updateError.message}` };
  }

  // Audit (append-only). Une erreur ici ne doit pas casser l'action.
  await supabase.from("order_events").insert({
    order_id: orderId,
    from_status: from,
    to_status: to,
    client_operation_id: clientOperationId ?? null,
  });

  revalidatePath("/dashboard");
  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
  return { success: "Commande mise à jour." };
}

/**
 * Valide un retrait à partir du code à 6 chiffres : passe la commande
 * (du commerçant connecté) en « récupérée ». N'accepte que les commandes
 * prêtes (transition ready → completed).
 */
export async function validatePickupCode(
  code: string,
  clientOperationId?: string
): Promise<OrderActionResult & { orderId?: string }> {
  const normalized = code.replace(/\D/g, "");
  if (normalized.length !== 6) {
    return { error: "Le code doit comporter 6 chiffres." };
  }

  const supabase = await createClient();

  // Idempotency PRIORITAIRE : si on a déjà appliqué ce client_operation_id,
  // on renvoie un succès SANS re-vérifier le statut. Sans ça, un retry après
  // une coupure réseau (action appliquée côté serveur mais réponse perdue)
  // tomberait sur le check `status === "completed"` et renverrait l'erreur
  // « déjà été récupérée » à un commerçant qui croit (à raison) avoir réussi.
  if (clientOperationId) {
    const { data: existing } = await supabase
      .from("order_events")
      .select("order_id")
      .eq("client_operation_id", clientOperationId)
      .maybeSingle();
    if (existing) {
      return {
        success: "Déjà appliqué.",
        orderId: existing.order_id,
      };
    }
  }

  const { data: order, error } = await supabase
    .from("orders")
    .select("id, status, customer_name")
    .eq("pickup_code", normalized)
    .maybeSingle();

  if (error) return { error: `Erreur : ${error.message}` };
  if (!order) return { error: "Aucune commande ne correspond à ce code." };
  if (order.status === "completed") {
    return { error: "Cette commande a déjà été récupérée." };
  }
  if (order.status === "cancelled") {
    return { error: "Cette commande a été annulée." };
  }
  if (order.status !== "ready") {
    return { error: "Cette commande n'est pas encore prête au retrait." };
  }

  const res = await updateOrderStatus(order.id, "completed", clientOperationId);
  if (res.error) return { error: res.error };

  return {
    success: `Retrait validé pour ${order.customer_name}.`,
    orderId: order.id,
  };
}
