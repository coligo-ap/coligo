"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import type { OrderStatus } from "@/lib/types";

const ALLOWED_STATUSES: OrderStatus[] = [
  "pending",
  "accepted",
  "preparing",
  "ready",
  "completed",
  "cancelled",
];

export type OrderActionResult = {
  error?: string;
  success?: string;
};

/**
 * Change le statut d'une commande. La RLS (orders_update_own_merchant) garantit
 * que seul le commerçant propriétaire peut modifier sa commande.
 */
export async function updateOrderStatus(
  orderId: string,
  status: OrderStatus
): Promise<OrderActionResult> {
  if (!ALLOWED_STATUSES.includes(status)) {
    return { error: "Statut invalide." };
  }

  const supabase = await createClient();
  const { error } = await supabase
    .from("orders")
    .update({ status })
    .eq("id", orderId);

  if (error) {
    return { error: `Erreur lors de la mise à jour : ${error.message}` };
  }

  revalidatePath("/dashboard");
  revalidatePath(`/orders/${orderId}`);
  return { success: "Commande mise à jour." };
}

/**
 * Valide un retrait à partir du code à 6 chiffres : passe la commande
 * correspondante (du commerçant connecté) en « récupérée ».
 *
 * La recherche est protégée par la RLS SELECT (le commerçant ne voit que ses
 * commandes) — un code d'un autre commerçant ne renvoie donc rien.
 */
export async function validatePickupCode(
  code: string
): Promise<OrderActionResult & { orderId?: string }> {
  const normalized = code.replace(/\D/g, "");
  if (normalized.length !== 6) {
    return { error: "Le code doit comporter 6 chiffres." };
  }

  const supabase = await createClient();

  const { data: order, error } = await supabase
    .from("orders")
    .select("id, status, customer_name")
    .eq("pickup_code", normalized)
    .maybeSingle();

  if (error) {
    return { error: `Erreur : ${error.message}` };
  }
  if (!order) {
    return { error: "Aucune commande ne correspond à ce code." };
  }
  if (order.status === "completed") {
    return { error: "Cette commande a déjà été récupérée." };
  }
  if (order.status === "cancelled") {
    return { error: "Cette commande a été annulée." };
  }

  const { error: updateError } = await supabase
    .from("orders")
    .update({ status: "completed" })
    .eq("id", order.id);

  if (updateError) {
    return { error: `Erreur lors de la validation : ${updateError.message}` };
  }

  revalidatePath("/dashboard");
  revalidatePath(`/orders/${order.id}`);
  return {
    success: `Retrait validé pour ${order.customer_name}.`,
    orderId: order.id,
  };
}
