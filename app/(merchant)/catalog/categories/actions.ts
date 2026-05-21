"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { categorySchema, firstZodError } from "@/lib/validation/product";

export type CategoryFormState = {
  error?: string;
};

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
  return categorySchema.safeParse({
    title: formData.get("title"),
    description: formData.get("description"),
    image_url: formData.get("image_url"),
  });
}

/** Prochaine position (à la fin) pour les catégories du commerçant. */
async function nextPosition(merchantId: string): Promise<number> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("categories")
    .select("position")
    .eq("merchant_id", merchantId)
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data?.position ?? -1) + 1;
}

export async function createCategory(
  _prevState: CategoryFormState,
  formData: FormData
): Promise<CategoryFormState> {
  const parsed = parseForm(formData);
  if (!parsed.success) return { error: firstZodError(parsed.error) };

  const merchantId = await getCurrentMerchantId();
  if (!merchantId) return { error: "Session expirée, reconnectez-vous." };

  const supabase = await createClient();
  const { error } = await supabase.from("categories").insert({
    merchant_id: merchantId,
    position: await nextPosition(merchantId),
    ...parsed.data,
  });

  if (error) return { error: `Erreur lors de la création : ${error.message}` };

  revalidatePath("/catalog/categories");
  revalidatePath("/catalog");
  redirect("/catalog/categories");
}

export async function updateCategory(
  categoryId: string,
  _prevState: CategoryFormState,
  formData: FormData
): Promise<CategoryFormState> {
  const parsed = parseForm(formData);
  if (!parsed.success) return { error: firstZodError(parsed.error) };

  const supabase = await createClient();
  const { error } = await supabase
    .from("categories")
    .update(parsed.data)
    .eq("id", categoryId);

  if (error)
    return { error: `Erreur lors de la mise à jour : ${error.message}` };

  revalidatePath("/catalog/categories");
  revalidatePath("/catalog");
  redirect("/catalog/categories");
}

export async function deleteCategory(categoryId: string): Promise<void> {
  const supabase = await createClient();
  // ON DELETE SET NULL : les produits liés deviennent « sans catégorie ».
  await supabase.from("categories").delete().eq("id", categoryId);
  revalidatePath("/catalog/categories");
  revalidatePath("/catalog");
  redirect("/catalog/categories");
}

/**
 * Déplace une catégorie d'un cran (haut/bas) en échangeant sa `position`
 * avec sa voisine.
 */
export async function moveCategory(
  categoryId: string,
  direction: "up" | "down"
): Promise<{ error?: string }> {
  const merchantId = await getCurrentMerchantId();
  if (!merchantId) return { error: "Session expirée." };

  const supabase = await createClient();
  const { data: cats, error } = await supabase
    .from("categories")
    .select("id, position")
    .eq("merchant_id", merchantId)
    .order("position", { ascending: true });

  if (error || !cats) return { error: error?.message ?? "Erreur." };

  const idx = cats.findIndex((c) => c.id === categoryId);
  if (idx === -1) return { error: "Catégorie introuvable." };

  const swapIdx = direction === "up" ? idx - 1 : idx + 1;
  if (swapIdx < 0 || swapIdx >= cats.length) return {}; // déjà aux extrémités

  const a = cats[idx];
  const b = cats[swapIdx];

  // Échange des positions (deux updates).
  await supabase
    .from("categories")
    .update({ position: b.position })
    .eq("id", a.id);
  await supabase
    .from("categories")
    .update({ position: a.position })
    .eq("id", b.id);

  revalidatePath("/catalog/categories");
  revalidatePath("/catalog");
  return {};
}

/**
 * Applique un ordre manuel aux catégories : position = index dans la liste.
 * (Réordonnancement par glisser-déposer.)
 */
export async function reorderCategories(
  orderedIds: string[]
): Promise<{ error?: string }> {
  if (orderedIds.length === 0) return {};
  const supabase = await createClient();
  const updates = orderedIds.map((id, index) =>
    supabase.from("categories").update({ position: index }).eq("id", id)
  );
  const results = await Promise.all(updates);
  const failed = results.find((r) => r.error);
  if (failed?.error) return { error: failed.error.message };

  revalidatePath("/catalog/categories");
  revalidatePath("/catalog");
  return {};
}

/** Supprime une ou plusieurs catégories (produits liés -> sans catégorie). */
export async function deleteCategories(
  ids: string[]
): Promise<{ error?: string }> {
  if (ids.length === 0) return {};
  const supabase = await createClient();
  const { error } = await supabase.from("categories").delete().in("id", ids);
  if (error) return { error: error.message };

  revalidatePath("/catalog/categories");
  revalidatePath("/catalog");
  return {};
}

/**
 * Création rapide « à la volée » depuis le formulaire produit. Renvoie la
 * catégorie créée (id + titre) pour l'ajouter au select sans rechargement.
 */
export async function quickCreateCategory(
  title: string
): Promise<{ error?: string; id?: string; title?: string }> {
  const clean = title.trim();
  if (!clean) return { error: "Le titre est requis." };

  const merchantId = await getCurrentMerchantId();
  if (!merchantId) return { error: "Session expirée." };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("categories")
    .insert({
      merchant_id: merchantId,
      title: clean,
      position: await nextPosition(merchantId),
    })
    .select("id, title")
    .single();

  if (error || !data) return { error: error?.message ?? "Échec." };

  revalidatePath("/catalog/categories");
  revalidatePath("/catalog");
  return { id: data.id, title: data.title };
}

/**
 * Crée en une fois des catégories suggérées (titres) qui n'existent pas encore,
 * à la suite des catégories existantes.
 */
export async function seedCategories(
  titles: string[]
): Promise<{ error?: string; created?: number }> {
  const merchantId = await getCurrentMerchantId();
  if (!merchantId) return { error: "Session expirée." };

  const supabase = await createClient();
  const { data: existing } = await supabase
    .from("categories")
    .select("title")
    .eq("merchant_id", merchantId);

  const existingTitles = new Set(
    (existing ?? []).map((c) => c.title.trim().toLowerCase())
  );
  const toCreate = titles.filter(
    (t) => !existingTitles.has(t.trim().toLowerCase())
  );
  if (toCreate.length === 0) return { created: 0 };

  let pos = await nextPosition(merchantId);
  const rows = toCreate.map((title) => ({
    merchant_id: merchantId,
    title,
    position: pos++,
  }));

  const { error } = await supabase.from("categories").insert(rows);
  if (error) return { error: error.message };

  revalidatePath("/catalog/categories");
  revalidatePath("/catalog");
  return { created: rows.length };
}
