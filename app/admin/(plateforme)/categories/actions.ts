"use server";

import { revalidatePath } from "next/cache";
import { adminCan } from "@/lib/auth/admin";
import { createAdminClient } from "@/lib/supabase/admin";
import { validateUploadedFile } from "@/lib/security/file-validation";

/**
 * Gestion super-admin (hub PLATEFORME, onglet Catégories) de la table
 * `merchant_categories` (mig 0311) : image du rond de filtre, STATUT
 * (actif / masqué / bientôt disponible), création, position, suppression,
 * mapping des filtres éditoriaux. Écritures service_role UNIQUEMENT (table
 * REVOKE côté client) ; chaque action re-garde adminCan('plateforme').
 */

const MAX_BYTES = 2 * 1024 * 1024;
const CODE_RE = /^[a-z0-9_]{2,40}$/;

function revalidate() {
  revalidatePath("/admin/categories");
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
  if (!(await adminCan("plateforme"))) return { error: "Accès refusé." };
  if (!(await categoryExists(code))) return { error: "Catégorie inconnue." };

  // Signature binaire vérifiée serveur (refuse SVG/HTML déguisés en image).
  const v = await validateUploadedFile(formData.get("file"), {
    kind: "image",
    maxBytes: MAX_BYTES,
  });
  if (!v.ok) return { error: v.error };

  const admin = createAdminClient();
  const path = `${code}.${v.ext}`;
  const { error: upErr } = await admin.storage
    .from("category-filters")
    .upload(path, v.bytes, { upsert: true, contentType: v.mime });
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
  if (!(await adminCan("plateforme"))) return { error: "Accès refusé." };
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
  if (!(await adminCan("plateforme"))) return { error: "Accès refusé." };
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

/** Création d'une catégorie — `kind` : type (inscription + filtre) ou
 *  FILTRE ÉDITORIAL (marketplace uniquement, phase 3) avec mots-clés
 *  pour le mapping automatique. */
export async function createCategory(input: {
  code: string;
  label: string;
  labelAr: string;
  emoji: string;
  kind?: "type" | "filter";
  keywords?: string;
}): Promise<{ ok?: true; error?: string }> {
  if (!(await adminCan("plateforme"))) return { error: "Accès refusé." };
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
    kind: input.kind === "filter" ? "filter" : "type",
    keywords: parseKeywords(input.keywords),
  } as never);
  if (error) return { error: error.message };
  revalidate();
  return { ok: true };
}

/** Édition des LIBELLÉS d'une catégorie (FR/AR + emoji). Le code technique,
 *  lui, est immuable (clé primaire référencée partout) — le renommage visible
 *  se propage partout puisque tout l'affichage lit label/label_ar par code. */
export async function updateCategoryLabels(
  code: string,
  input: { label: string; labelAr: string; emoji: string }
): Promise<{ ok?: true; error?: string }> {
  if (!(await adminCan("plateforme"))) return { error: "Accès refusé." };
  const label = input.label.trim();
  const labelAr = input.labelAr.trim();
  if (!label || !labelAr) return { error: "Libellés FR et AR requis." };
  if (!(await categoryExists(code))) return { error: "Catégorie inconnue." };

  const admin = createAdminClient();
  const { error } = await admin
    .from("merchant_categories" as never)
    .update({
      label,
      label_ar: labelAr,
      emoji: input.emoji.trim() || "🏷️",
      updated_at: new Date().toISOString(),
    } as never)
    .eq("code", code);
  if (error) return { error: error.message };
  revalidate();
  return { ok: true };
}

/** « burger, hamburger » → ['burger','hamburger'] (max 12, nettoyés). */
function parseKeywords(raw?: string): string[] {
  return [
    ...new Set(
      (raw ?? "")
        .split(/[,;\n]/)
        .map((s) => s.trim().toLowerCase())
        .filter((s) => s.length >= 2 && s.length <= 40)
    ),
  ].slice(0, 12);
}

/** Mots-clés du mapping AUTO d'un filtre (puis recalcul à la demande). */
export async function setCategoryKeywords(
  code: string,
  raw: string
): Promise<{ ok?: true; error?: string }> {
  if (!(await adminCan("plateforme"))) return { error: "Accès refusé." };
  const admin = createAdminClient();
  const { error } = await admin
    .from("merchant_categories" as never)
    .update({
      keywords: parseKeywords(raw),
      updated_at: new Date().toISOString(),
    } as never)
    .eq("code", code);
  if (error) return { error: error.message };
  revalidate();
  return { ok: true };
}

/**
 * RECALCUL AUTO des liaisons d'un filtre : matche les commerçants dont les
 * PRODUITS (name_fr/name_ar) ou les TAGS contiennent un mot-clé. Ne touche
 * QUE les liaisons source='auto' (manuel + principale intouchées).
 */
export async function recomputeAutoLinks(
  code: string
): Promise<{ ok?: true; added?: number; error?: string }> {
  if (!(await adminCan("plateforme"))) return { error: "Accès refusé." };
  const admin = createAdminClient();
  const { data: cat } = await admin
    .from("merchant_categories" as never)
    .select("keywords")
    .eq("code", code)
    .maybeSingle();
  const keywords = ((cat as { keywords?: string[] } | null)?.keywords ?? [])
    .map((k) => k.trim().toLowerCase())
    .filter(Boolean);
  if (keywords.length === 0)
    return { error: "Ajoutez d'abord des mots-clés à ce filtre." };

  const matched = new Set<string>();
  // Produits : nom FR/AR contenant un mot-clé.
  for (const kw of keywords) {
    const { data } = await admin
      .from("products")
      .select("merchant_id")
      .or(`name_fr.ilike.%${kw}%,name_ar.ilike.%${kw}%`)
      .limit(2000);
    for (const r of data ?? [])
      matched.add((r as { merchant_id: string }).merchant_id);
  }
  // Tags + nom du commerce.
  const { data: merchs } = await admin
    .from("merchants")
    .select("id, name, tags");
  for (const m of (merchs ?? []) as {
    id: string;
    name: string;
    tags: string[] | null;
  }[]) {
    const hay = [m.name, ...(m.tags ?? [])].join(" ").toLowerCase();
    if (keywords.some((kw) => hay.includes(kw))) matched.add(m.id);
  }

  // Remplace les liaisons AUTO uniquement.
  await admin
    .from("merchant_category_links" as never)
    .delete()
    .eq("code", code)
    .eq("source", "auto");
  let added = 0;
  if (matched.size > 0) {
    const rows = [...matched].map((merchant_id) => ({
      merchant_id,
      code,
      source: "auto",
    }));
    // upsert ignoreDuplicates : une liaison manuelle/principale existante prime.
    const { error } = await admin
      .from("merchant_category_links" as never)
      .upsert(rows as never, {
        onConflict: "merchant_id,code",
        ignoreDuplicates: true,
      });
    if (error) return { error: error.message };
    added = rows.length;
  }
  revalidate();
  return { ok: true, added };
}

/** Commerçants liés à un filtre (nom + provenance) — panneau admin. */
export async function listFilterMerchants(code: string): Promise<{
  rows: { merchantId: string; name: string; source: string }[];
  error?: string;
}> {
  if (!(await adminCan("plateforme")))
    return { rows: [], error: "Accès refusé." };
  const admin = createAdminClient();
  const { data: links } = await admin
    .from("merchant_category_links" as never)
    .select("merchant_id, source")
    .eq("code", code)
    .limit(500);
  const ids = ((links ?? []) as unknown as { merchant_id: string }[]).map(
    (l) => l.merchant_id
  );
  if (ids.length === 0) return { rows: [] };
  const { data: merchs } = await admin
    .from("merchants")
    .select("id, name")
    .in("id", ids);
  const nameById = new Map(
    ((merchs ?? []) as { id: string; name: string }[]).map((m) => [
      m.id,
      m.name,
    ])
  );
  return {
    rows: (
      (links ?? []) as unknown as { merchant_id: string; source: string }[]
    )
      .map((l) => ({
        merchantId: l.merchant_id,
        name: nameById.get(l.merchant_id) ?? l.merchant_id,
        source: l.source,
      }))
      .sort((a, b) => a.name.localeCompare(b.name)),
  };
}

/** Recherche de commerçants par nom (mapping manuel d'un filtre). */
export async function searchMerchantsForFilter(
  q: string
): Promise<{ rows: { id: string; name: string }[] }> {
  if (!(await adminCan("plateforme"))) return { rows: [] };
  const needle = q.trim();
  if (needle.length < 2) return { rows: [] };
  const admin = createAdminClient();
  const { data } = await admin
    .from("merchants")
    .select("id, name")
    .ilike("name", `%${needle}%`)
    .limit(8);
  return { rows: (data ?? []) as { id: string; name: string }[] };
}

/** Attache / détache MANUELLEMENT un commerçant à un filtre. */
export async function attachMerchantToFilter(
  code: string,
  merchantId: string
): Promise<{ ok?: true; error?: string }> {
  if (!(await adminCan("plateforme"))) return { error: "Accès refusé." };
  const admin = createAdminClient();
  const { error } = await admin
    .from("merchant_category_links" as never)
    .upsert({ merchant_id: merchantId, code, source: "manual" } as never, {
      onConflict: "merchant_id,code",
      ignoreDuplicates: true,
    });
  if (error) return { error: error.message };
  revalidate();
  return { ok: true };
}

export async function detachMerchantFromFilter(
  code: string,
  merchantId: string
): Promise<{ ok?: true; error?: string }> {
  if (!(await adminCan("plateforme"))) return { error: "Accès refusé." };
  const admin = createAdminClient();
  const { error } = await admin
    .from("merchant_category_links" as never)
    .delete()
    .eq("code", code)
    .eq("merchant_id", merchantId);
  if (error) return { error: error.message };
  revalidate();
  return { ok: true };
}

/** Suppression — REFUSÉE si un TYPE est utilisé par des commerçants, en
 *  catégorie PRINCIPALE ou par TOUTE liaison restante (sinon le CASCADE
 *  effacerait des liaisons en silence) : on ne casse jamais des données
 *  existantes. Un FILTRE éditorial reste supprimable — son mapping lui
 *  appartient et part avec lui. Garde + delete ATOMIQUES via
 *  admin_delete_category (mig 0319, FOR UPDATE) : aucune fenêtre où un
 *  commerçant gagne la catégorie entre le comptage et le DELETE. */
export async function deleteCategory(
  code: string
): Promise<{ ok?: true; error?: string }> {
  if (!(await adminCan("plateforme"))) return { error: "Accès refusé." };
  const admin = createAdminClient();
  const { data, error: rpcErr } = await admin.rpc(
    "admin_delete_category" as never,
    { p_code: code } as never
  );
  if (rpcErr) return { error: rpcErr.message };
  const res = (data as unknown as string) ?? "";
  if (res === "not_found") return { error: "Catégorie inconnue." };
  if (res.startsWith("primary:"))
    return {
      error: `${res.slice(8)} commerçant(s) utilisent cette catégorie — masquez-la plutôt.`,
    };
  if (res.startsWith("links:"))
    return {
      error: `${res.slice(6)} commerçant(s) ont encore une liaison vers cette catégorie — retirez-les (fiche commerçant) ou masquez-la.`,
    };
  // Ligne supprimée : le ménage storage se fait APRÈS coup (plus d'image
  // perdue si la garde refuse).
  await admin.storage
    .from("category-filters")
    .remove([`${code}.png`, `${code}.webp`]);
  revalidate();
  return { ok: true };
}
