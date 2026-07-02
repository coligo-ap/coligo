"use server";

import { revalidatePath } from "next/cache";
import { adminCan } from "@/lib/auth/admin";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * PHASE 1 catégories — gestion super-admin (domaine Marketing) de la table
 * `merchant_categories` (mig 0311) : image du rond de filtre, STATUT
 * (actif / masqué / bientôt disponible), création, position, suppression.
 * Écritures service_role UNIQUEMENT (table REVOKE côté client) ; chaque
 * action re-garde adminCan('marketing').
 */

const MAX_BYTES = 2 * 1024 * 1024;
const CODE_RE = /^[a-z0-9_]{2,40}$/;

function revalidate() {
  revalidatePath("/admin/bannieres");
  revalidatePath("/admin/marketing");
}

async function categoryExists(code: string): Promise<boolean> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("merchant_categories" as never)
    .select("code")
    .eq("code", code)
    .maybeSingle();
  return !!data;
}

export async function upsertCategoryFilterImage(
  code: string,
  formData: FormData
): Promise<{ ok?: true; error?: string }> {
  if (!(await adminCan("marketing"))) return { error: "Accès refusé." };
  if (!(await categoryExists(code))) return { error: "Catégorie inconnue." };

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
  const url = `${pub.publicUrl}?v=${Date.now()}`;

  const { error: dbErr } = await admin
    .from("merchant_categories" as never)
    .update({ image_url: url, updated_at: new Date().toISOString() } as never)
    .eq("code", code);
  if (dbErr) return { error: dbErr.message };
  revalidate();
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
    .from("merchant_categories" as never)
    .update({ image_url: null, updated_at: new Date().toISOString() } as never)
    .eq("code", code);
  if (error) return { error: error.message };
  revalidate();
  return { ok: true };
}

/** Statut : active / hidden / coming_soon (enforcement serveur à l'inscription). */
export async function setCategoryStatus(
  code: string,
  status: "active" | "hidden" | "coming_soon"
): Promise<{ ok?: true; error?: string }> {
  if (!(await adminCan("marketing"))) return { error: "Accès refusé." };
  if (!["active", "hidden", "coming_soon"].includes(status))
    return { error: "Statut invalide." };
  const admin = createAdminClient();
  const { error } = await admin
    .from("merchant_categories" as never)
    .update({ status, updated_at: new Date().toISOString() } as never)
    .eq("code", code);
  if (error) return { error: error.message };
  revalidate();
  return { ok: true };
}

/** Création d'une catégorie (code technique + libellés FR/AR + emoji). */
export async function createCategory(input: {
  code: string;
  label: string;
  labelAr: string;
  emoji: string;
}): Promise<{ ok?: true; error?: string }> {
  if (!(await adminCan("marketing"))) return { error: "Accès refusé." };
  const code = input.code.trim().toLowerCase();
  if (!CODE_RE.test(code))
    return { error: "Code invalide (a-z, 0-9, _ ; 2-40 caractères)." };
  const label = input.label.trim();
  const labelAr = input.labelAr.trim();
  if (!label || !labelAr) return { error: "Libellés FR et AR requis." };
  if (await categoryExists(code)) return { error: "Ce code existe déjà." };

  const admin = createAdminClient();
  // Position = fin de liste.
  const { data: last } = await admin
    .from("merchant_categories" as never)
    .select("position")
    .order("position", { ascending: false })
    .limit(1)
    .maybeSingle();
  const position = ((last as { position?: number } | null)?.position ?? 0) + 10;
  const { error } = await admin.from("merchant_categories" as never).insert({
    code,
    label,
    label_ar: labelAr,
    emoji: input.emoji.trim() || "🏷️",
    position,
  } as never);
  if (error) return { error: error.message };
  revalidate();
  return { ok: true };
}

/** Suppression — REFUSÉE si des commerçants utilisent la catégorie (masquer
 *  à la place) : on ne casse jamais des données existantes. */
export async function deleteCategory(
  code: string
): Promise<{ ok?: true; error?: string }> {
  if (!(await adminCan("marketing"))) return { error: "Accès refusé." };
  const admin = createAdminClient();
  const { count } = await admin
    .from("merchants")
    .select("id", { count: "exact", head: true })
    .eq("category", code);
  if ((count ?? 0) > 0)
    return {
      error: `${count} commerçant(s) utilisent cette catégorie — masquez-la plutôt.`,
    };
  await admin.storage
    .from("category-filters")
    .remove([`${code}.png`, `${code}.webp`]);
  const { error } = await admin
    .from("merchant_categories" as never)
    .delete()
    .eq("code", code);
  if (error) return { error: error.message };
  revalidate();
  return { ok: true };
}
