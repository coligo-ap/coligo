"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMerchantId } from "@/lib/auth/merchant";
import { productSchema, firstZodError } from "@/lib/validation/product";

export type ProductFormState = {
  error?: string;
  ok?: boolean;
};

function parseForm(formData: FormData) {
  return productSchema.safeParse({
    name_fr: formData.get("name_fr"),
    name_ar: formData.get("name_ar"),
    description_fr: formData.get("description_fr"),
    description_ar: formData.get("description_ar"),
    price_da: formData.get("price_da"),
    unit: formData.get("unit"),
    category_id: formData.get("category_id"),
    stock_qty: formData.get("stock_qty"),
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
  return { ok: true };
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
  return { ok: true };
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

/**
 * Duplique un produit (copie tous les champs sauf l'id) et redirige vers
 * l'édition de la copie pour ajustement.
 */
export async function duplicateProduct(
  productId: string
): Promise<{ error?: string; id?: string }> {
  const supabase = await createClient();

  const { data: src, error: readError } = await supabase
    .from("products")
    .select(
      `merchant_id, name_fr, name_ar, description_fr, description_ar,
       price_da, unit, category_id, stock_qty, image_url, is_available`
    )
    .eq("id", productId)
    .maybeSingle();

  if (readError || !src) {
    return { error: readError?.message ?? "Produit introuvable." };
  }

  const { data: copy, error: insertError } = await supabase
    .from("products")
    .insert({ ...src, name_fr: `${src.name_fr} (copie)` })
    .select("id")
    .single();

  if (insertError || !copy) {
    return { error: insertError?.message ?? "Échec de la duplication." };
  }

  revalidatePath("/catalog");
  return { id: copy.id };
}

/** Rend disponibles/masqués plusieurs produits d'un coup. */
export async function bulkSetAvailability(
  productIds: string[],
  isAvailable: boolean
): Promise<{ error?: string }> {
  if (productIds.length === 0) return {};
  const supabase = await createClient();
  const { error } = await supabase
    .from("products")
    .update({ is_available: isAvailable })
    .in("id", productIds);

  if (error) return { error: error.message };
  revalidatePath("/catalog");
  return {};
}

/** Supprime un ou plusieurs produits (sans redirection). */
export async function deleteProducts(
  productIds: string[]
): Promise<{ error?: string }> {
  if (productIds.length === 0) return {};
  const supabase = await createClient();
  const { error } = await supabase
    .from("products")
    .delete()
    .in("id", productIds);

  if (error) return { error: error.message };
  revalidatePath("/catalog");
  return {};
}

/**
 * Applique un ordre manuel aux produits : position = index dans la liste.
 * (Réordonnancement par glisser-déposer.)
 */
export async function reorderProducts(
  orderedIds: string[]
): Promise<{ error?: string }> {
  if (orderedIds.length === 0) return {};
  const supabase = await createClient();
  const updates = orderedIds.map((id, index) =>
    supabase.from("products").update({ position: index }).eq("id", id)
  );
  const results = await Promise.all(updates);
  const failed = results.find((r) => r.error);
  if (failed?.error) return { error: failed.error.message };

  revalidatePath("/catalog");
  return {};
}

/** Assigne (ou retire, si null) une catégorie à plusieurs produits. */
export async function bulkAssignCategory(
  productIds: string[],
  categoryId: string | null
): Promise<{ error?: string }> {
  if (productIds.length === 0) return {};
  const supabase = await createClient();
  const { error } = await supabase
    .from("products")
    .update({ category_id: categoryId })
    .in("id", productIds);

  if (error) return { error: error.message };
  revalidatePath("/catalog");
  return {};
}
