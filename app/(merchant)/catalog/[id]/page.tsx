import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ProductForm } from "@/components/merchant/product-form";
import { ProductOptionsEditor } from "@/components/merchant/product-options-editor";
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

  // RLS garantit qu'on ne récupère qu'un produit appartenant au commerçant.
  const { data: product } = await supabase
    .from("products")
    .select(
      `id, merchant_id, name_fr, name_ar, description_fr, description_ar,
       price_da, unit, category, image_url, is_available, created_at, updated_at`
    )
    .eq("id", id)
    .is("archived_at", null)
    .maybeSingle();

  if (!product) notFound();

  const [categories, optionGroups] = await Promise.all([
    getMerchantCategories(),
    getProductOptions(id),
  ]);

  return (
    <>
      <ProductForm
        merchantId={merchant.id}
        product={product as Product}
        categories={categories}
      />
      <div className="mx-auto max-w-2xl px-4 pb-10 lg:px-8">
        <ProductOptionsEditor productId={id} initialGroups={optionGroups} />
      </div>
    </>
  );
}
