import { notFound, redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { CategoryForm } from "@/components/merchant/category-form";
import type { Category } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function EditCategoryPage({
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

  const { data: category } = await supabase
    .from("categories")
    .select(
      "id, merchant_id, title, description, image_url, position, created_at, updated_at"
    )
    .eq("id", id)
    .maybeSingle();

  if (!category) notFound();

  return (
    <CategoryForm merchantId={merchant.id} category={category as Category} />
  );
}
