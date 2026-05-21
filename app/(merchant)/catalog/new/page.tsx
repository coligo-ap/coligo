import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { ProductForm } from "@/components/merchant/product-form";

export const dynamic = "force-dynamic";

export default async function NewProductPage() {
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

  const { data: rows } = await supabase
    .from("products")
    .select("category")
    .not("category", "is", null);

  const existingCategories = Array.from(
    new Set((rows ?? []).map((r) => r.category).filter(Boolean) as string[])
  ).sort((a, b) => a.localeCompare(b, "fr"));

  return (
    <ProductForm
      merchantId={merchant.id}
      existingCategories={existingCategories}
    />
  );
}
