import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ProductForm } from "@/components/merchant/product-form";
import { getMerchantCategories } from "@/lib/data/catalog";

export const dynamic = "force-dynamic";

export default async function NewProductPage({
  searchParams,
}: {
  searchParams: Promise<{ category?: string }>;
}) {
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

  const categories = await getMerchantCategories();
  const { category } = await searchParams;
  // Pré-sélection uniquement si la catégorie appartient bien au commerçant.
  const initialCategoryId = categories.some((c) => c.id === category)
    ? category
    : undefined;

  return (
    <ProductForm
      merchantId={merchant.id}
      categories={categories}
      initialCategoryId={initialCategoryId}
    />
  );
}
