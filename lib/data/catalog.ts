import { createClient } from "@/lib/supabase/server";
import { getCurrentMerchantId } from "@/lib/auth/merchant";
import type { Category } from "@/lib/types";

/**
 * Catégories du commerçant connecté, triées par position.
 *
 * IMPORTANT — on filtre EXPLICITEMENT par `merchant_id`. On NE peut PAS se
 * reposer sur la RLS : `categories` a des policies SELECT PUBLIQUES
 * (`categories_select_public` / `_public_active`, nécessaires à la vitrine
 * client) → sans ce filtre, le menu déroulant de catégories (pages nouveau /
 * édition produit) remontait les catégories de TOUS les commerces. Même piège
 * que `fetchCatalog` (cf. products_select_public_active).
 */
export async function getMerchantCategories(): Promise<Category[]> {
  const merchantId = await getCurrentMerchantId();
  if (!merchantId) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("categories")
    .select(
      "id, merchant_id, title, description, image_url, position, created_at, updated_at"
    )
    .eq("merchant_id", merchantId)
    .order("position", { ascending: true });
  return (data ?? []) as Category[];
}
