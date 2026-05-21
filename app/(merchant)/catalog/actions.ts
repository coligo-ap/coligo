"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { productSchema, firstZodError } from "@/lib/validation/product";

export type ProductFormState = {
  error?: string;
};

/**
 * Récupère le merchant_id du commerçant connecté, ou null.
 * (La RLS protège déjà les écritures, mais on en a besoin pour l'insert.)
 */
async function getCurrentMerchantId(): Promise<string | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const { data: merchant } = await supabase
    .from("merchants")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();

  return merchant?.id ?? null;
}

function parseForm(formData: FormData) {
  return productSchema.safeParse({
    name_fr: formData.get("name_fr"),
    name_ar: formData.get("name_ar"),
    description_fr: formData.get("description_fr"),
    description_ar: formData.get("description_ar"),
    price_da: formData.get("price_da"),
    unit: formData.get("unit"),
    category: formData.get("category"),
    image_url: formData.get("image_url"),
    is_available: formData.get("is_available"),
  });
}

export async function createProduct(
  _prevState: ProductFormState,
  formData: FormData
): Promise<ProductFormState> {
  const parsed = parseForm(formData);
  if (!parsed.success) {
    return { error: firstZodError(parsed.error) };
  }

  const merchantId = await getCurrentMerchantId();
  if (!merchantId) {
    return { error: "Session expirée, reconnectez-vous." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("products").insert({
    merchant_id: merchantId,
    ...parsed.data,
  });

  if (error) {
    return { error: `Erreur lors de la création : ${error.message}` };
  }

  revalidatePath("/catalog");
  redirect("/catalog");
}

export async function updateProduct(
  productId: string,
  _prevState: ProductFormState,
  formData: FormData
): Promise<ProductFormState> {
  const parsed = parseForm(formData);
  if (!parsed.success) {
    return { error: firstZodError(parsed.error) };
  }

  const supabase = await createClient();
  // RLS garantit que l'update ne touche qu'un produit du commerçant connecté.
  const { error } = await supabase
    .from("products")
    .update(parsed.data)
    .eq("id", productId);

  if (error) {
    return { error: `Erreur lors de la mise à jour : ${error.message}` };
  }

  revalidatePath("/catalog");
  redirect("/catalog");
}

export async function deleteProduct(productId: string): Promise<void> {
  const supabase = await createClient();
  await supabase.from("products").delete().eq("id", productId);
  revalidatePath("/catalog");
  redirect("/catalog");
}

export async function toggleProductAvailability(
  productId: string,
  isAvailable: boolean
): Promise<{ error?: string }> {
  const supabase = await createClient();
  const { error } = await supabase
    .from("products")
    .update({ is_available: isAvailable })
    .eq("id", productId);

  if (error) {
    return { error: error.message };
  }

  revalidatePath("/catalog");
  return {};
}
