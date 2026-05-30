"use server";

// =============================================================================
// Server Actions reviews — submitReview / updateReview.
// =============================================================================
// Ceinture + bretelles : les vérifs critiques sont aussi dans la RLS et le
// trigger validate_review SQL. Ces vérifs côté Server Action donnent des
// messages d'erreur compréhensibles côté UI.
// =============================================================================

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";

export type ReviewResult = { ok: true } | { ok: false; error: string };

const MAX_COMMENT = 500;

export async function submitReview(input: {
  order_id: string;
  rating: number;
  comment?: string | null;
}): Promise<ReviewResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Tu dois te reconnecter." };

  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
    return { ok: false, error: "Note invalide (1 à 5)." };
  }
  const comment = (input.comment ?? "").trim().slice(0, MAX_COMMENT) || null;

  // Récupère customer + merchant_id côté serveur — interdit toute injection
  // par l'utilisateur de couples (order, customer, merchant) incohérents.
  const { data: customer } = await supabase
    .from("customers")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!customer) return { ok: false, error: "Profil client introuvable." };

  const { data: order } = await supabase
    .from("orders")
    .select("id, customer_id, merchant_id, status")
    .eq("id", input.order_id)
    .maybeSingle();
  if (!order) return { ok: false, error: "Commande introuvable." };
  if (order.customer_id !== customer.id) {
    return { ok: false, error: "Cette commande ne t'appartient pas." };
  }
  if (order.status !== "completed") {
    return {
      ok: false,
      error: "Tu peux noter ta commande uniquement après l'avoir récupérée.",
    };
  }

  const { error } = await supabase.from("reviews").insert({
    order_id: order.id,
    customer_id: customer.id,
    merchant_id: order.merchant_id,
    rating: input.rating,
    comment,
  });
  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "Tu as déjà noté cette commande." };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath("/");
  revalidatePath(`/commandes/${order.id}`);
  return { ok: true };
}

export async function submitDriverReview(input: {
  order_id: string;
  rating: number;
  comment?: string | null;
}): Promise<ReviewResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Tu dois te reconnecter." };

  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
    return { ok: false, error: "Note invalide (1 à 5)." };
  }
  const comment = (input.comment ?? "").trim().slice(0, MAX_COMMENT) || null;

  const { data: customer } = await supabase
    .from("customers")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!customer) return { ok: false, error: "Profil client introuvable." };

  const { data: order } = await supabase
    .from("orders")
    .select("id, customer_id, delivery_driver_id, status")
    .eq("id", input.order_id)
    .maybeSingle();
  if (!order) return { ok: false, error: "Commande introuvable." };
  if (order.customer_id !== customer.id) {
    return { ok: false, error: "Cette commande ne t'appartient pas." };
  }
  if (order.status !== "completed") {
    return {
      ok: false,
      error: "Tu peux noter le livreur uniquement après la livraison.",
    };
  }
  if (!order.delivery_driver_id) {
    return { ok: false, error: "Aucun livreur sur cette commande." };
  }

  const { error } = await supabase.from("driver_reviews").insert({
    order_id: order.id,
    customer_id: customer.id,
    driver_id: order.delivery_driver_id,
    rating: input.rating,
    comment,
  });
  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "Tu as déjà noté ce livreur." };
    }
    return { ok: false, error: error.message };
  }

  revalidatePath(`/commandes/${order.id}`);
  return { ok: true };
}

export async function updateReview(input: {
  review_id: string;
  rating: number;
  comment?: string | null;
}): Promise<ReviewResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Tu dois te reconnecter." };

  if (!Number.isInteger(input.rating) || input.rating < 1 || input.rating > 5) {
    return { ok: false, error: "Note invalide (1 à 5)." };
  }
  const comment = (input.comment ?? "").trim().slice(0, MAX_COMMENT) || null;

  const { error } = await supabase
    .from("reviews")
    .update({ rating: input.rating, comment })
    .eq("id", input.review_id);
  if (error) {
    // Le trigger SQL renvoie un message lisible (« Ton avis n'est plus
    // modifiable (24h passées). ») qu'on remonte tel quel.
    return { ok: false, error: error.message };
  }

  revalidatePath("/");
  return { ok: true };
}
