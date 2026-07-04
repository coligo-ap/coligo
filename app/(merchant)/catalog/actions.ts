"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { getCurrentMerchantId } from "@/lib/auth/merchant";
import { productSchema, firstZodError } from "@/lib/validation/product";
import { productsStoragePathFromPublicUrl } from "@/lib/images/storage-path";
import type { Category, ProductWithCategory } from "@/lib/types";

export type ProductFormState = {
  error?: string;
  ok?: boolean;
};

/**
 * Catalogue du commerçant connecté (loader TanStack `/catalog`).
 *
 * IMPORTANT — on filtre EXPLICITEMENT par `merchant_id`. On NE peut PAS se
 * reposer sur la RLS : la policy publique `products_select_public_active` rend
 * visibles les produits disponibles de TOUS les commerces actifs (nécessaire à
 * la marketplace client). Sans ce filtre, le catalogue du commerçant remontait
 * des centaines de produits d'autres commerces (versés dans « Sans catégorie »),
 * surchargeant le glisser-déposer et fuitant des données.
 */
export async function fetchCatalog(): Promise<{
  products: ProductWithCategory[];
  categories: Category[];
  error: string | null;
}> {
  const merchantId = await getCurrentMerchantId();
  if (!merchantId) {
    return { products: [], categories: [], error: "Session expirée." };
  }

  const supabase = await createClient();
  const [{ data: products, error }, { data: categories }] = await Promise.all([
    supabase
      .from("products")
      .select(
        `id, merchant_id, name_fr, name_ar, description_fr, description_ar,
         price_da, unit, category, category_id, stock_qty, min_qty, max_qty,
         position, image_url, is_available, created_at, updated_at,
         categories ( id, title )`
      )
      .eq("merchant_id", merchantId)
      // Les produits archivés (supprimés par le commerçant) restent en base
      // pour la traçabilité mais ne s'affichent plus dans le catalogue.
      .is("archived_at", null)
      .order("position", { ascending: true })
      .order("created_at", { ascending: false }),
    supabase
      .from("categories")
      .select(
        "id, merchant_id, title, description, image_url, position, created_at, updated_at"
      )
      .eq("merchant_id", merchantId)
      .order("position", { ascending: true }),
  ]);
  return {
    products: (products ?? []) as ProductWithCategory[],
    categories: (categories ?? []) as Category[],
    error: error?.message ?? null,
  };
}

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
    min_qty: formData.get("min_qty"),
    max_qty: formData.get("max_qty"),
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
  // Position = fin de SA catégorie (sinon le nouveau produit atterrit à 0 et
  // casse l'ordre de classement). Scopé (commerce, catégorie).
  const catId = parsed.data.category_id ?? null;
  let posQuery = supabase
    .from("products")
    .select("position")
    .eq("merchant_id", merchantId)
    .order("position", { ascending: false })
    .limit(1);
  posQuery = catId
    ? posQuery.eq("category_id", catId)
    : posQuery.is("category_id", null);
  const { data: lastPos } = await posQuery.maybeSingle();
  const position = ((lastPos?.position as number | undefined) ?? -1) + 1;

  const { error } = await supabase.from("products").insert({
    merchant_id: merchantId,
    position,
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

/**
 * « Supprime » un ou plusieurs produits = ARCHIVAGE DOUX (sans redirection).
 *
 * On ne fait JAMAIS de hard delete : la fiche produit est conservée pour la
 * traçabilité. Les ventes passées sont déjà figées dans order_items (snapshot
 * du nom + des prix, aucune FK vers products) → finances/commissions/Coligo Pay
 * ne bougent pas d'un centime. L'archivage rend le produit invisible :
 *   • côté commerçant : filtre archived_at IS NULL dans fetchCatalog ;
 *   • côté client      : is_available=false (la RLS publique exige true).
 * La photo est supprimée du storage pour ne pas accumuler de fichiers inutiles
 * (le produit archivé n'a plus besoin de son image).
 */
export async function deleteProducts(
  productIds: string[]
): Promise<{ error?: string }> {
  if (productIds.length === 0) return {};
  const merchantId = await getCurrentMerchantId();
  if (!merchantId) return { error: "Session expirée." };
  const supabase = await createClient();

  // 1) Récupère les images à libérer. On BORNE par merchant_id : `products` a
  //    une policy SELECT publique (products_select_public_active) → sans ce
  //    filtre, des ids étrangers renverraient les image_url d'autres boutiques
  //    (et alimenteraient à tort l'étape 3). Cf. reference_merchant_query_rls_leak.
  const { data: rows } = await supabase
    .from("products")
    .select("image_url")
    .eq("merchant_id", merchantId)
    .in("id", productIds)
    .not("image_url", "is", null);

  // 2) Archive : conservé en base, invisible partout. Explicitement borné au
  //    commerçant (en plus de la RLS UPDATE products_update_own).
  const { error } = await supabase
    .from("products")
    .update({ archived_at: new Date().toISOString(), is_available: false })
    .eq("merchant_id", merchantId)
    .in("id", productIds);
  if (error) return { error: error.message };

  // 3) Nettoyage des photos du bucket `products` (best-effort, JAMAIS bloquant :
  //    l'archivage est déjà commité ci-dessus → un échec storage ne doit pas
  //    faire échouer/throw la suppression).
  try {
    const paths = (rows ?? [])
      .map((r) => productsStoragePathFromPublicUrl(r.image_url))
      .filter((p): p is string => !!p);
    if (paths.length > 0) {
      await supabase.storage.from("products").remove(paths);
    }
  } catch {
    /* ignore — produit déjà archivé */
  }

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
