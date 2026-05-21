import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CategoriesManager } from "@/components/merchant/categories-manager";
import { suggestedCategoriesFor } from "@/lib/config/category-suggestions";
import type { Category } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function CategoriesPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: merchant } = await supabase
    .from("merchants")
    .select("id, category")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!merchant) redirect("/login?error=no_merchant");

  const [{ data: categories }, { data: products }] = await Promise.all([
    supabase
      .from("categories")
      .select(
        "id, merchant_id, title, description, image_url, position, created_at, updated_at"
      )
      .order("position", { ascending: true }),
    supabase.from("products").select("category_id"),
  ]);

  // Comptage des produits par catégorie.
  const counts = new Map<string, number>();
  for (const p of products ?? []) {
    if (p.category_id)
      counts.set(p.category_id, (counts.get(p.category_id) ?? 0) + 1);
  }

  const rows = ((categories ?? []) as Category[]).map((c) => ({
    ...c,
    productCount: counts.get(c.id) ?? 0,
  }));

  return (
    <CategoriesManager
      categories={rows}
      suggestions={suggestedCategoriesFor(merchant.category)}
    />
  );
}
