"use server";

import { revalidatePath } from "next/cache";
import { adminCan } from "@/lib/auth/admin";
import { createAdminClient } from "@/lib/supabase/admin";

/**
 * Hub Commerçants — RACCORDEMENT d'un commerçant à ses catégories (mig 0312) :
 * changement de la catégorie PRINCIPALE (merchants.category, miroir 'primary'
 * dans merchant_category_links) + ajout/retrait de catégories SECONDAIRES
 * (liaisons source='manual'). Écritures service_role (tables REVOKE côté
 * client) ; chaque action re-garde adminCan('commercants').
 * Tables hors database.types.ts généré → accès `as never` (pattern existant).
 */

type CatRow = {
  code: string;
  label: string;
  emoji: string;
  kind: string;
};

async function getCategory(code: string): Promise<CatRow | null> {
  const admin = createAdminClient();
  const { data } = await admin
    .from("merchant_categories" as never)
    .select("code, label, emoji, kind")
    .eq("code", code)
    .maybeSingle();
  return (data as CatRow | null) ?? null;
}

/** Catégories d'un commerçant : principale + toutes les liaisons (libellé,
 *  nature, provenance) — panneau de la fiche admin. */
export async function listMerchantCategories(merchantId: string): Promise<{
  primary: string | null;
  links: {
    code: string;
    label: string;
    emoji: string;
    kind: "type" | "filter";
    source: string;
  }[];
  error?: string;
}> {
  if (!(await adminCan("commercants")))
    return { primary: null, links: [], error: "Accès refusé." };
  const admin = createAdminClient();

  const { data: merch } = await admin
    .from("merchants")
    .select("category")
    .eq("id", merchantId)
    .maybeSingle();
  const primary =
    (merch as { category: string | null } | null)?.category ?? null;

  const { data: links } = await admin
    .from("merchant_category_links" as never)
    .select("code, source")
    .eq("merchant_id", merchantId);
  const linkRows = (links ?? []) as unknown as {
    code: string;
    source: string;
  }[];
  if (linkRows.length === 0) return { primary, links: [] };

  // Libellés en bloc (table courte).
  const { data: cats } = await admin
    .from("merchant_categories" as never)
    .select("code, label, emoji, kind");
  const byCode = new Map(
    ((cats ?? []) as unknown as CatRow[]).map((c) => [c.code, c])
  );
  return {
    primary,
    links: linkRows
      .map((l) => {
        const c = byCode.get(l.code);
        return {
          code: l.code,
          label: c?.label ?? l.code,
          emoji: c?.emoji ?? "🏷️",
          kind: (c?.kind === "filter" ? "filter" : "type") as "type" | "filter",
          source: l.source,
        };
      })
      .sort((a, b) =>
        a.source === "primary"
          ? -1
          : b.source === "primary"
            ? 1
            : a.label.localeCompare(b.label)
      ),
  };
}

/** Change la catégorie PRINCIPALE : merchants.category + provenance des
 *  liaisons re-synchronisée (l'ancienne principale reste en secondaire
 *  'manual' — aucune visibilité perdue silencieusement). */
export async function setMerchantPrimaryCategory(
  merchantId: string,
  code: string
): Promise<{ ok?: true; error?: string }> {
  if (!(await adminCan("commercants"))) return { error: "Accès refusé." };
  const cat = await getCategory(code);
  if (!cat) return { error: "Catégorie inconnue." };
  if (cat.kind !== "type")
    return {
      error: "Un filtre éditorial ne peut pas être catégorie principale.",
    };

  const admin = createAdminClient();
  // Le trigger merchants_sync_primary_category crée la liaison 'primary'.
  const { error: upErr } = await admin
    .from("merchants")
    .update({ category: code })
    .eq("id", merchantId);
  if (upErr) return { error: upErr.message };

  // L'ancienne principale devient une liaison secondaire (manuel).
  const { error: demoteErr } = await admin
    .from("merchant_category_links" as never)
    .update({ source: "manual" } as never)
    .eq("merchant_id", merchantId)
    .eq("source", "primary")
    .neq("code", code);
  if (demoteErr) return { error: demoteErr.message };

  // Si la liaison existait déjà (manuel/auto), la promouvoir en 'primary'
  // (le trigger fait ON CONFLICT DO NOTHING et ne l'aurait pas promue).
  const { error: promoteErr } = await admin
    .from("merchant_category_links" as never)
    .update({ source: "primary" } as never)
    .eq("merchant_id", merchantId)
    .eq("code", code);
  if (promoteErr) return { error: promoteErr.message };

  revalidatePath("/admin/merchants");
  return { ok: true };
}

/** Ajoute une catégorie SECONDAIRE (type ou filtre éditorial). */
export async function addMerchantCategoryLink(
  merchantId: string,
  code: string
): Promise<{ ok?: true; error?: string }> {
  if (!(await adminCan("commercants"))) return { error: "Accès refusé." };
  if (!(await getCategory(code))) return { error: "Catégorie inconnue." };
  const admin = createAdminClient();
  const { error } = await admin
    .from("merchant_category_links" as never)
    .upsert({ merchant_id: merchantId, code, source: "manual" } as never, {
      onConflict: "merchant_id,code",
      ignoreDuplicates: true,
    });
  if (error) return { error: error.message };
  revalidatePath("/admin/merchants");
  return { ok: true };
}

/** Retire une liaison — REFUSÉ sur la principale (changez-la d'abord). */
export async function removeMerchantCategoryLink(
  merchantId: string,
  code: string
): Promise<{ ok?: true; error?: string }> {
  if (!(await adminCan("commercants"))) return { error: "Accès refusé." };
  const admin = createAdminClient();
  const { data: merch } = await admin
    .from("merchants")
    .select("category")
    .eq("id", merchantId)
    .maybeSingle();
  if ((merch as { category: string | null } | null)?.category === code)
    return {
      error: "C'est la catégorie principale — changez-la avant de la retirer.",
    };
  const { error } = await admin
    .from("merchant_category_links" as never)
    .delete()
    .eq("merchant_id", merchantId)
    .eq("code", code);
  if (error) return { error: error.message };
  revalidatePath("/admin/merchants");
  return { ok: true };
}
