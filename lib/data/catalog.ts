import { createClient } from "@/lib/supabase/server";
import type { Category } from "@/lib/types";

/** Catégories du commerçant connecté, triées par position (RLS = ses données). */
export async function getMerchantCategories(): Promise<Category[]> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("categories")
    .select(
      "id, merchant_id, title, description, image_url, position, created_at, updated_at"
    )
    .order("position", { ascending: true });
  return (data ?? []) as Category[];
}
