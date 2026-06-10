"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import {
  isValidTransition,
  ORDER_STATUS_META,
  type OrderStatus,
} from "@/lib/types";
import {
  notifyCustomerStatusChange,
  notifyDriversNewExpress,
  notifyDriverOrderCancelled,
} from "@/lib/fcm/triggers";

export type OrderActionResult = {
  error?: string;
  success?: string;
  /**
   * `true` quand l'erreur vient d'un board PÉRIMÉ : la commande n'est plus dans
   * l'état attendu (auto-refusée après 15 min, ou déjà avancée par un autre
   * écran). Le client doit alors re-synchroniser l'affichage (router.refresh /
   * passage à la commande suivante) plutôt que de laisser une carte morte.
   */
  stale?: boolean;
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
  clientOperationId?: string,
  note?: string | null
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
    // Message clair (pas de jargon « cancelled → preparing ») : le plus souvent
    // le board est PÉRIMÉ — la commande a été auto-refusée (non acceptée sous
    // 15 min) ou avancée ailleurs entre l'affichage et le clic.
    const label = ORDER_STATUS_META[from]?.label ?? from;
    const message =
      from === "cancelled"
        ? "Cette commande a déjà été annulée (refus, ou non acceptée sous 15 min). La liste va se rafraîchir."
        : from === "completed"
          ? "Cette commande est déjà terminée. La liste va se rafraîchir."
          : `Action impossible : la commande est déjà « ${label} ». La liste va se rafraîchir.`;
    return { error: message, stale: true };
  }

  const { error: updateError } = await supabase
    .from("orders")
    .update({ status: to })
    .eq("id", orderId);

  if (updateError) {
    return { error: `Erreur lors de la mise à jour : ${updateError.message}` };
  }

  // Audit (append-only). Une erreur ici ne doit pas casser l'action.
  // `note` sert notamment à tracer le MOTIF d'un refus (rupture, surcharge…).
  await supabase.from("order_events").insert({
    order_id: orderId,
    from_status: from,
    to_status: to,
    client_operation_id: clientOperationId ?? null,
    note: note?.slice(0, 200) ?? null,
  });

  // Push FCM au client si le nouveau statut est significatif (preparing /
  // ready / completed / cancelled). Fire-and-forget — pas de blocage.
  void notifyCustomerStatusChange({ orderId, newStatus: to });

  // Express : on alerte les livreurs DÈS le DÉBUT de la préparation (la course
  // est sur le réseau immédiatement — mig 0129 — le livreur peut foncer pendant
  // que le plat se prépare). On ré-alerte à « prête » au cas où personne n'a
  // encore pris la course. Le helper revérifie mode/attribution (no-op sinon).
  if (to === "preparing" || to === "ready") {
    void notifyDriversNewExpress({ orderId });
  }

  revalidatePath("/dashboard");
  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
  return { success: "Commande mise à jour." };
}

/**
 * Annulation commerçant DURCIE (mig 0117) — appel de confirmation client.
 *
 * Passe par la RPC `merchant_cancel_order` (SECURITY DEFINER) qui :
 *  - vérifie la propriété de la commande,
 *  - REFUSE si le livreur a déjà récupéré la commande (already_picked_up),
 *  - libère le livreur express + rembourse un éventuel paiement en ligne,
 *  - trace le motif (par défaut « Client injoignable »).
 * À utiliser pour TOUTE annulation commerçant (refus pending inclus) à la place
 * d'un simple updateOrderStatus → 'cancelled'.
 */
export async function cancelOrderByMerchant(
  orderId: string,
  reason?: string
): Promise<OrderActionResult> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "merchant_cancel_order" as never,
    {
      p_order_id: orderId,
      p_reason: reason ?? null,
    } as never
  );
  if (error) return { error: `Erreur : ${error.message}` };
  const res = data as { ok: boolean; reason?: string } | null;
  if (!res?.ok) {
    const map: Record<string, { msg: string; stale?: boolean }> = {
      already_picked_up: {
        msg: "Impossible d'annuler : le livreur a déjà récupéré la commande. Contacte le support (super-admin) si besoin.",
        stale: true,
      },
      already_terminal: {
        msg: "Cette commande est déjà terminée ou annulée. La liste va se rafraîchir.",
        stale: true,
      },
      forbidden: { msg: "Action non autorisée." },
      order_not_found: { msg: "Commande introuvable.", stale: true },
    };
    const e = map[res?.reason ?? ""] ?? { msg: "Annulation impossible." };
    return { error: e.msg, stale: e.stale };
  }

  void notifyCustomerStatusChange({ orderId, newStatus: "cancelled" });
  // Stoppe le livreur s'il avait accepté la course (push instantané ; le pop-up
  // + arrêt en temps réel sont gérés par DriverCancelWatch côté app livreur).
  void notifyDriverOrderCancelled({ orderId });
  revalidatePath("/dashboard");
  revalidatePath("/orders");
  revalidatePath(`/orders/${orderId}`);
  return { success: "Commande annulée." };
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
  // PIN à 4 chiffres (commandes récentes) ; on tolère 6 pour d'éventuelles
  // commandes legacy non encore régénérées.
  if (normalized.length < 4 || normalized.length > 6) {
    return { error: "Le code doit comporter 4 chiffres." };
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
    .select("id, status, customer_name, fulfillment_type")
    .eq("pickup_code", normalized)
    .maybeSingle();

  if (error) return { error: `Erreur : ${error.message}` };
  if (!order) return { error: "Aucune commande ne correspond à ce code." };
  // Les commandes en LIVRAISON ne se valident JAMAIS côté commerçant : le
  // livreur récupère la commande puis confirme la remise au client. Le code
  // n'est destiné qu'au livreur (anti-fraude). On refuse donc ici.
  if (order.fulfillment_type === "delivery") {
    return {
      error:
        "Commande en livraison : la remise est confirmée par le livreur, pas au comptoir.",
    };
  }
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
