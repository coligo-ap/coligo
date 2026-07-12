import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ProductEditTabs } from "@/components/merchant/product-editor-tabs";
import { getProductOptions } from "@/app/(merchant)/catalog/options/actions";
import { getMerchantCategories } from "@/lib/data/catalog";
import type { Product } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function EditProductPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/login");

  const { data: merchant } = await supabase
    .from("merchants")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!merchant) redirect("/login?error=no_merchant");

  // On filtre EXPLICITEMENT par merchant_id : la RLS ne suffit PAS (la policy
  // publique `products_select_public_active` rend tout produit actif lisible →
  // sans ce filtre, un commerçant pourrait ouvrir la fiche d'édition d'un
  // produit d'un AUTRE commerce). Un id étranger ⇒ notFound().
  const { data: product } = await supabase
    .from("products")
    .select(
      `id, merchant_id, name_fr, name_ar, description_fr, description_ar,
       price_da, unit, category, category_id, stock_qty, min_qty, max_qty,
       barcode, image_url, is_available, created_at, updated_at`
    )
    .eq("id", id)
    .eq("merchant_id", merchant.id)
    .is("archived_at", null)
    .maybeSingle();

  if (!product) notFound();

  const [categories, optionGroups] = await Promise.all([
    getMerchantCategories(),
    getProductOptions(id),
  ]);

  return (
    <ProductEditTabs
      merchantId={merchant.id}
      product={product as unknown as Product}
      categories={categories}
      initialGroups={optionGroups}
    />
  );
}
