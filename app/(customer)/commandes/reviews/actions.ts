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

  const ALREADY_REVIEWED = "Tu as déjà donné ton avis sur ce commerce. Merci !";

  // UN SEUL avis par COMMERÇANT : si le client a déjà noté ce commerce (sur une
  // autre commande), on refuse poliment au lieu d'empiler les avis (la note ne
  // compte de toute façon qu'un avis par client — mig 0065). Pré-check pour un
  // message clair ; le vrai garde-fou anti-course est la contrainte UNIQUE
  // (customer_id, merchant_id) en DB (mig 0069), gérée plus bas via 23505.
  const { data: existing } = await supabase
    .from("reviews")
    .select("id")
    .eq("customer_id", customer.id)
    .eq("merchant_id", order.merchant_id)
    .limit(1);
  if (existing && existing.length > 0) {
    return { ok: false, error: ALREADY_REVIEWED };
  }

  const { error } = await supabase.from("reviews").insert({
    order_id: order.id,
    customer_id: customer.id,
    merchant_id: order.merchant_id,
    rating: input.rating,
    comment,
  });
  if (error) {
    // 23505 = violation d'unicité : soit (order_id) [mig 0027], soit
    // (customer_id, merchant_id) [mig 0069]. Dans les deux cas le client a déjà
    // un avis sur ce commerce → même message qu'au pré-check (gère la course).
    if (error.code === "23505") {
      return { ok: false, error: ALREADY_REVIEWED };
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

// =============================================================================
// Signalement d'un LIVREUR par le client (motif + détails).
// =============================================================================
// Écriture via la RPC SECURITY DEFINER `submit_delivery_report` (mig 0095) :
// le rôle (client) et la cohérence commande sont vérifiés côté serveur.
export async function reportDriver(input: {
  order_id: string;
  reason: string;
  details?: string | null;
}): Promise<ReviewResult> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Tu dois te reconnecter." };

  const reason = (input.reason ?? "").trim().slice(0, 60);
  if (!reason) return { ok: false, error: "Choisis un motif." };
  const details = (input.details ?? "").trim().slice(0, 1000) || null;

  const { data, error } = await supabase.rpc(
    "submit_delivery_report" as never,
    {
      p_order_id: input.order_id,
      p_reason: reason,
      p_details: details,
    } as never
  );
  if (error) return { ok: false, error: error.message };
  const row = (Array.isArray(data) ? data[0] : data) as
    | { ok?: boolean; reason?: string | null }
    | undefined;
  if (!row?.ok) {
    const r = row?.reason ?? "";
    const msg =
      r === "already_reported"
        ? "Tu as déjà signalé cette livraison."
        : r === "no_delivery"
          ? "Aucun livreur sur cette commande."
          : "Signalement impossible pour le moment.";
    return { ok: false, error: msg };
  }
  revalidatePath(`/commandes/${input.order_id}`);
  return { ok: true };
}
