"use server";

import { revalidatePath } from "next/cache";
import { adminCan } from "@/lib/auth/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { MERCHANT_CATEGORIES } from "@/lib/config/categories";

/**
 * Images des FILTRES de catégories (marketplace client) — gestion super-admin
 * (domaine Marketing). Upload dans le bucket public `category-filters` +
 * upsert de `category_filter_images` (écriture service_role UNIQUEMENT, la
 * table est REVOKE côté client, mig 0310). Le strip client applique l'image
 * automatiquement, avec repli emoji.
 */

const MAX_BYTES = 2 * 1024 * 1024; // 2 Mo — largement assez pour un rond 54px.

export async function upsertCategoryFilterImage(
  code: string,
  formData: FormData
): Promise<{ ok?: true; error?: string }> {
  if (!(await adminCan("marketing"))) return { error: "Accès refusé." };
  if (!MERCHANT_CATEGORIES.some((c) => c.code === code))
    return { error: "Catégorie inconnue." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0)
    return { error: "Choisissez une image." };
  if (file.size > MAX_BYTES) return { error: "Image trop lourde (max 2 Mo)." };
  if (!file.type.startsWith("image/")) return { error: "Fichier non image." };

  const admin = createAdminClient();
  const ext = file.type === "image/webp" ? "webp" : "png";
  const path = `${code}.${ext}`;
  const { error: upErr } = await admin.storage
    .from("category-filters")
    .upload(path, file, { upsert: true, contentType: file.type });
  if (upErr) return { error: `Upload échoué : ${upErr.message}` };

  const { data: pub } = admin.storage
    .from("category-filters")
    .getPublicUrl(path);
  // Cache-bust : l'URL change à chaque remplacement → le strip se met à jour.
  const url = `${pub.publicUrl}?v=${Date.now()}`;

  const { error: dbErr } = await admin
    .from("category_filter_images" as never)
    .upsert(
      { code, image_url: url, updated_at: new Date().toISOString() } as never,
      { onConflict: "code" }
    );
  if (dbErr) return { error: dbErr.message };

  revalidatePath("/admin/bannieres");
  revalidatePath("/admin/marketing");
  return { ok: true };
}

export async function deleteCategoryFilterImage(
  code: string
): Promise<{ ok?: true; error?: string }> {
  if (!(await adminCan("marketing"))) return { error: "Accès refusé." };
  const admin = createAdminClient();
  await admin.storage
    .from("category-filters")
    .remove([`${code}.png`, `${code}.webp`]);
  const { error } = await admin
    .from("category_filter_images" as never)
    .delete()
    .eq("code", code);
  if (error) return { error: error.message };
  revalidatePath("/admin/bannieres");
  revalidatePath("/admin/marketing");
  return { ok: true };
}
