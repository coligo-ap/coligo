import { createClient } from "@/lib/supabase/server";
import { CatalogView } from "@/components/merchant/catalog-view";
import { APP_CONFIG } from "@/lib/config/app-config";
import type { Category, ProductWithCategory } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function CatalogPage() {
  const supabase = await createClient();

  // La RLS filtre déjà sur le commerçant connecté.
  const [{ data: products, error }, { data: categories }] = await Promise.all([
    supabase
      .from("products")
      .select(
        `id, merchant_id, name_fr, name_ar, description_fr, description_ar,
         price_da, unit, category, category_id, stock_qty, image_url,
         is_available, created_at, updated_at,
         categories ( id, title )`
      )
      .order("created_at", { ascending: false }),
    supabase
      .from("categories")
      .select(
        "id, merchant_id, title, description, image_url, position, created_at, updated_at"
      )
      .order("position", { ascending: true }),
  ]);

  if (error) {
    return (
      <div className="p-4 lg:p-6">
        <div className="rounded-[10px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          Erreur de chargement du catalogue : {error.message}
        </div>
      </div>
    );
  }

  return (
    <CatalogView
      products={(products ?? []) as ProductWithCategory[]}
      categories={(categories ?? []) as Category[]}
      lowStockThreshold={APP_CONFIG.catalog.lowStockThreshold}
    />
  );
}
