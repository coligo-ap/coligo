import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";

/**
 * Récupère, pour un commerçant donné, la catégorie de chaque produit dont le
 * `name_fr` figure dans la liste. Best-effort — un produit renommé/supprimé
 * ne sera pas catégorisé (l'item retombe sous « ARTICLES » côté ticket).
 *
 * Une seule requête, idempotente. Marche aussi bien côté serveur (RSC) que
 * côté client (bridge Realtime), via la même interface SupabaseClient.
 */
export async function fetchCategoryMap(
  supabase: SupabaseClient<Database>,
  merchantId: string,
  productNames: string[]
): Promise<Record<string, string>> {
  const uniq = Array.from(new Set(productNames.filter(Boolean)));
  if (uniq.length === 0) return {};

  const { data, error } = await supabase
    .from("products")
    .select("name_fr, categories ( title )")
    .eq("merchant_id", merchantId)
    .in("name_fr", uniq);

  if (error || !data) return {};

  const map: Record<string, string> = {};
  for (const row of data) {
    // `categories` est typé `{ title } | { title }[] | null` selon le contexte
    // — on lit le titre quel que soit le format renvoyé.
    const cat = row.categories as
      | { title: string }
      | { title: string }[]
      | null;
    const title = Array.isArray(cat) ? cat[0]?.title : cat?.title;
    if (title) map[row.name_fr] = title;
  }
  return map;
}
