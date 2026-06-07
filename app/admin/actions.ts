"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSuperAdmin } from "@/lib/auth/admin";
import { getCatalogTemplate } from "@/lib/config/catalog-templates";
import {
  merchantRatesSchema,
  platformSettingsSchema,
  pctToRate,
} from "@/lib/validation/platform";

export type AdminFormState = { error?: string; ok?: boolean };

export async function updatePlatformSettings(
  _prev: AdminFormState,
  formData: FormData
): Promise<AdminFormState> {
  if (!(await isSuperAdmin())) return { error: "Accès refusé." };

  const parsed = platformSettingsSchema.safeParse({
    commission_cash: formData.get("commission_cash"),
    commission_online: formData.get("commission_online"),
    cashback_online: formData.get("cashback_online"),
    cashback_cash: formData.get("cashback_cash"),
    chargily_fee: formData.get("chargily_fee"),
    max_debt_da: formData.get("max_debt_da"),
    delivery_base_da: formData.get("delivery_base_da"),
    delivery_per_km_da: formData.get("delivery_per_km_da"),
    delivery_free_km_threshold: formData.get("delivery_free_km_threshold"),
    delivery_min_da: formData.get("delivery_min_da"),
    delivery_max_da: formData.get("delivery_max_da"),
    delivery_max_radius_km: formData.get("delivery_max_radius_km"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Données invalides" };
  }
  const d = parsed.data;

  const supabase = await createClient();
  const { error } = await supabase
    .from("platform_settings")
    .update({
      commission_cash: pctToRate(d.commission_cash),
      commission_online: pctToRate(d.commission_online),
      cashback_online: pctToRate(d.cashback_online),
      cashback_cash: pctToRate(d.cashback_cash),
      chargily_fee: pctToRate(d.chargily_fee),
      max_debt_da: d.max_debt_da,
      delivery_base_da: d.delivery_base_da,
      delivery_per_km_da: d.delivery_per_km_da,
      delivery_free_km_threshold: d.delivery_free_km_threshold,
      delivery_min_da: d.delivery_min_da,
      delivery_max_da: d.delivery_max_da,
      delivery_max_radius_km: d.delivery_max_radius_km,
      updated_at: new Date().toISOString(),
    })
    .eq("id", true);

  if (error) return { error: `Échec : ${error.message}` };

  revalidatePath("/admin/settings");
  return { ok: true };
}

export async function updateMerchantRates(
  merchantId: string,
  _prev: AdminFormState,
  formData: FormData
): Promise<AdminFormState> {
  if (!(await isSuperAdmin())) return { error: "Accès refusé." };

  const parsed = merchantRatesSchema.safeParse({
    commission_cash: formData.get("commission_cash"),
    commission_online: formData.get("commission_online"),
    cashback_online: formData.get("cashback_online"),
    cashback_cash: formData.get("cashback_cash"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Données invalides" };
  }
  const d = parsed.data;
  const toRate = (v: number | null) => (v == null ? null : pctToRate(v));

  const supabase = await createClient();
  const { error } = await supabase
    .from("merchants")
    .update({
      commission_cash: toRate(d.commission_cash),
      commission_online: toRate(d.commission_online),
      cashback_online: toRate(d.cashback_online),
      cashback_cash: toRate(d.cashback_cash),
    })
    .eq("id", merchantId);

  if (error) return { error: `Échec : ${error.message}` };

  revalidatePath("/admin/merchants");
  return { ok: true };
}

export async function toggleMerchantFrozen(
  merchantId: string,
  frozen: boolean
): Promise<{ error?: string }> {
  if (!(await isSuperAdmin())) return { error: "Accès refusé." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("merchants")
    .update({ is_frozen: frozen })
    .eq("id", merchantId);

  if (error) return { error: error.message };

  // Audit
  const {
    data: { user },
  } = await supabase.auth.getUser();
  await supabase.from("admin_audit_log").insert({
    admin_email: user?.email ?? null,
    action: frozen ? "freeze_merchant" : "unfreeze_merchant",
    target_kind: "merchant",
    target_id: merchantId,
  });

  revalidatePath("/admin/merchants");
  return {};
}

/**
 * Gel d'un livreur (anti-fraude / sanction administrative).
 * Un livreur gelé reste connecté mais voit un écran "compte gelé" sur
 * `/driver` ; il ne peut plus rien faire jusqu'au dégel.
 */
export async function toggleDriverFrozen(
  driverId: string,
  frozen: boolean,
  note?: string
): Promise<{ error?: string }> {
  if (!(await isSuperAdmin())) return { error: "Accès refusé." };

  const supabase = await createClient();
  const { error } = await supabase
    .from("drivers")
    .update({ is_frozen: frozen })
    .eq("id", driverId);
  if (error) return { error: error.message };

  const {
    data: { user },
  } = await supabase.auth.getUser();
  await supabase.from("admin_audit_log").insert({
    admin_email: user?.email ?? null,
    action: frozen ? "freeze_driver" : "unfreeze_driver",
    target_kind: "driver",
    target_id: driverId,
    note: note ?? null,
  });

  revalidatePath("/admin/drivers");
  return {};
}

// =============================================================================
// Remplissage AUTOMATIQUE du catalogue d'un commerçant (super-admin).
// =============================================================================
// Le super-admin remplit le magasin d'un commerçant à partir d'un MODÈLE Coligo
// (catégories + produits courants, prix indicatifs) selon son type de commerce.
// Le commerçant ajuste ensuite prix / détails / photos (tout est éditable).
//
// - Données 100 % possédées (cf. lib/config/catalog-templates) — aucune copie
//   d'un catalogue tiers, aucune photo importée (le commerçant ajoute les siennes).
// - Service-role : l'admin agit sur le magasin d'un AUTRE commerçant (hors RLS).
// - IDEMPOTENT : on n'ajoute pas une catégorie / un produit déjà présents (par
//   titre / nom) → on peut relancer sans créer de doublons.
// =============================================================================
export type SeedCatalogResult =
  | { ok: true; categoriesAdded: number; productsAdded: number; label: string }
  | { ok: false; error: string };

const norm = (s: string) =>
  s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().trim();

export async function seedMerchantCatalog(
  merchantId: string,
  templateType?: string
): Promise<SeedCatalogResult> {
  if (!(await isSuperAdmin())) return { ok: false, error: "Accès refusé." };
  if (!merchantId) return { ok: false, error: "Commerçant manquant." };

  const admin = createAdminClient();

  const { data: merchant, error: mErr } = await admin
    .from("merchants")
    .select("id, category")
    .eq("id", merchantId)
    .maybeSingle();
  if (mErr || !merchant) return { ok: false, error: "Commerçant introuvable." };

  const type = (templateType || merchant.category || "").trim();
  const tpl = getCatalogTemplate(type);
  if (!tpl) {
    return {
      ok: false,
      error: `Aucun modèle de catalogue pour le type « ${type || "?"} ».`,
    };
  }

  // État existant (idempotence par titre de catégorie / nom de produit).
  const { data: existCats } = await admin
    .from("categories")
    .select("id, title")
    .eq("merchant_id", merchantId);
  const catIdByTitle = new Map<string, string>();
  for (const c of existCats ?? []) catIdByTitle.set(norm(c.title), c.id);

  const { data: existProds } = await admin
    .from("products")
    .select("name_fr")
    .eq("merchant_id", merchantId);
  const prodNames = new Set<string>(
    (existProds ?? []).map((p) => norm(p.name_fr))
  );

  let categoriesAdded = 0;
  let productsAdded = 0;
  let position = existCats?.length ?? 0;

  for (const cat of tpl.categories) {
    let categoryId = catIdByTitle.get(norm(cat.title));
    if (!categoryId) {
      const { data: insCat, error: cErr } = await admin
        .from("categories")
        .insert({
          merchant_id: merchantId,
          title: cat.title,
          position: position++,
        })
        .select("id")
        .single();
      if (cErr || !insCat) continue;
      categoryId = insCat.id;
      catIdByTitle.set(norm(cat.title), categoryId);
      categoriesAdded++;
    }

    const rows = cat.products
      .filter((p) => !prodNames.has(norm(p.name_fr)))
      .map((p) => ({
        merchant_id: merchantId,
        name_fr: p.name_fr,
        name_ar: p.name_ar ?? null,
        price_da: p.price_da,
        unit: p.unit ?? "piece",
        category_id: categoryId ?? null,
        is_available: true,
      }));

    if (rows.length > 0) {
      const { error: pErr } = await admin.from("products").insert(rows);
      if (!pErr) {
        for (const r of rows) prodNames.add(norm(r.name_fr));
        productsAdded += rows.length;
      }
    }
  }

  // Audit : qui a rempli, quel magasin, combien.
  const {
    data: { user },
  } = await (await createClient()).auth.getUser();
  await admin.from("admin_audit_log").insert({
    admin_email: user?.email ?? null,
    action: "seed_catalog",
    target_kind: "merchant",
    target_id: merchantId,
    note: `${tpl.label} · +${categoriesAdded} cat. / +${productsAdded} produits`,
  });

  revalidatePath("/admin/merchants");
  return { ok: true, categoriesAdded, productsAdded, label: tpl.label };
}

// =============================================================================
// Modération des signalements de livraison (super-admin).
// =============================================================================
export async function resolveDeliveryReport(input: {
  reportId: string;
  status: "open" | "reviewing" | "resolved" | "dismissed";
  note?: string | null;
}): Promise<AdminFormState> {
  if (!(await isSuperAdmin())) return { error: "Accès refusé." };
  const supabase = await createClient();
  const rpc = supabase.rpc as unknown as (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  const { data, error } = await rpc("admin_resolve_delivery_report", {
    p_report_id: input.reportId,
    p_status: input.status,
    p_note: input.note ?? null,
  });
  if (error) return { error: error.message };
  const row = (Array.isArray(data) ? data[0] : data) as
    | { ok?: boolean; reason?: string | null }
    | undefined;
  if (!row?.ok) return { error: row?.reason ?? "Échec." };
  revalidatePath("/admin/reports");
  return { ok: true };
}
