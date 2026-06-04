// =============================================================================
// Avis clients — lectures (côté serveur, lectures RLS-safe).
// =============================================================================
// Toutes les VALIDATIONS critiques sont déjà côté SQL (UNIQUE order_id,
// trigger validate_review qui exige commande completed + propriétaire,
// fenêtre 24h). Ces helpers font de la lecture + sucrent un peu côté UX.
// =============================================================================

import { createClient } from "@/lib/supabase/server";

export type Review = {
  id: string;
  order_id: string;
  customer_id: string;
  merchant_id: string;
  rating: number; // 1..5
  comment: string | null;
  is_hidden: boolean;
  created_at: string;
  edited_at: string | null;
};

export type ReviewWithCustomer = Review & {
  customer_name: string | null;
};

/**
 * Renvoie l'avis du client connecté sur une commande donnée, s'il existe.
 */
export async function getMyReviewForOrder(
  orderId: string
): Promise<Review | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data } = await supabase
    .from("reviews")
    .select("*")
    .eq("order_id", orderId)
    .maybeSingle();
  return (data as Review | null) ?? null;
}

/**
 * Renvoie de quoi inviter le client à noter — UN SEUL avis par COMMERÇANT.
 *
 * Règle UX (anti-harcèlement) : on ne demande pas un avis par commande. Si le
 * client a commandé 5 fois chez le même commerçant, on ne propose qu'UNE fois
 * de le noter (sur sa commande la plus récente). Et dès qu'il a noté ce
 * commerçant (n'importe quelle commande), on ne le sollicite plus du tout pour
 * lui. Cohérent avec le calcul de la note (1 avis par client — mig 0065).
 *
 * Limit : N pour ne pas pourrir la home si le client a beaucoup de commerces.
 */
export type ReviewableOrder = {
  order_id: string;
  merchant_id: string;
  merchant_name: string;
  merchant_logo_url: string | null;
  completed_at: string;
};

export async function getMyReviewableOrders(
  limit = 5
): Promise<ReviewableOrder[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];

  const { data: customer } = await supabase
    .from("customers")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!customer) return [];

  const { data: orders } = await supabase
    .from("orders")
    .select(
      `id, merchant_id, created_at,
       merchants ( name, logo_url )`
    )
    .eq("customer_id", customer.id)
    .eq("status", "completed")
    .order("created_at", { ascending: false })
    .limit(40);

  if (!orders || orders.length === 0) return [];

  // Commerces que le client a DÉJÀ notés (un avis par commerçant suffit) — on
  // les exclut entièrement de l'invitation.
  const { data: myReviews } = await supabase
    .from("reviews")
    .select("merchant_id")
    .eq("customer_id", customer.id);
  const reviewedMerchants = new Set(
    (myReviews ?? []).map((r) => r.merchant_id as string)
  );

  // On garde la commande la plus RÉCENTE de chaque commerçant pas encore noté
  // (orders est trié récent → ancien) → une seule invitation par commerçant.
  const seenMerchant = new Set<string>();
  const out: ReviewableOrder[] = [];
  for (const o of orders) {
    if (reviewedMerchants.has(o.merchant_id)) continue;
    if (seenMerchant.has(o.merchant_id)) continue;
    seenMerchant.add(o.merchant_id);
    const m = (
      o as unknown as {
        merchants: { name: string; logo_url: string | null } | null;
      }
    ).merchants;
    out.push({
      order_id: o.id,
      merchant_id: o.merchant_id,
      merchant_name: m?.name ?? "Commerce",
      merchant_logo_url: m?.logo_url ?? null,
      completed_at: o.created_at,
    });
    if (out.length >= limit) break;
  }
  return out;
}

/**
 * Renvoie les N derniers avis publics d'un commerçant (pour /m/[slug]).
 * Joint customers.full_name pour afficher le prénom de l'auteur (anonymisé
 * partiellement côté UI : "Mehdi B.").
 *
 * DIVERSITÉ / ANTI-FRAUDE : on n'affiche qu'UN SEUL avis par client (le PLUS
 * RÉCENT). Un client qui commande plusieurs fois pourrait sinon laisser 3 avis
 * et monopoliser / gonfler / saboter la vitrine. En ne gardant que le dernier
 * avis de chaque client, on diversifie les voix affichées.
 */
export async function getMerchantReviews(
  merchantId: string,
  limit = 20
): Promise<ReviewWithCustomer[]> {
  const supabase = await createClient();
  // Tirage élargi AVANT dédoublonnage par client, puis on tronque à `limit`.
  const { data } = await supabase
    .from("reviews")
    .select(
      `id, order_id, customer_id, merchant_id, rating, comment,
       is_hidden, created_at, edited_at,
       customers ( full_name )`
    )
    .eq("merchant_id", merchantId)
    .eq("is_hidden", false)
    .order("created_at", { ascending: false })
    .limit(200);

  const seen = new Set<string>();
  const out: ReviewWithCustomer[] = [];
  for (const r of data ?? []) {
    // Trié par date décroissante → 1er vu pour un client = son avis le plus récent.
    if (seen.has(r.customer_id)) continue;
    seen.add(r.customer_id);
    const c = (
      r as unknown as { customers: { full_name: string | null } | null }
    ).customers;
    out.push({
      id: r.id,
      order_id: r.order_id,
      customer_id: r.customer_id,
      merchant_id: r.merchant_id,
      rating: r.rating,
      comment: r.comment,
      is_hidden: r.is_hidden,
      created_at: r.created_at,
      edited_at: r.edited_at,
      customer_name: c?.full_name ?? null,
    });
    if (out.length >= limit) break;
  }
  return out;
}
