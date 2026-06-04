import { createClient } from "@/lib/supabase/server";
import {
  listPublicMerchantsByIds,
  type PublicMerchant,
} from "@/lib/data/merchants-public";

// =============================================================================
// Favoris client — lecture (la RLS de `customer_favorites` filtre déjà au
// client connecté ; on renvoie un Set vide pour un visiteur non connecté).
// =============================================================================

/** IDs des commerces favoris du client connecté (Set vide si non connecté). */
export async function getMyFavoriteIds(): Promise<Set<string>> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return new Set();
  const { data } = await supabase
    .from("customer_favorites")
    .select("merchant_id");
  return new Set((data ?? []).map((r) => r.merchant_id as string));
}

/** Commerces favoris (vitrines complètes) du client, du plus récent au plus
 *  ancien. Vide si non connecté ou aucun favori. */
export async function getFavoriteMerchants(): Promise<PublicMerchant[]> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return [];
  // On lit les favoris ordonnés (plus récents d'abord) puis on hydrate.
  const { data: favs } = await supabase
    .from("customer_favorites")
    .select("merchant_id, created_at")
    .order("created_at", { ascending: false });
  const ids = (favs ?? []).map((r) => r.merchant_id as string);
  if (ids.length === 0) return [];
  const merchants = await listPublicMerchantsByIds(ids);
  // Conserve l'ordre « ajouté récemment d'abord ».
  const byId = new Map(merchants.map((m) => [m.id, m]));
  return ids.map((id) => byId.get(id)).filter((m): m is PublicMerchant => !!m);
}
