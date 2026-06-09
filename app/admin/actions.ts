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

  // ⚠️ La table `drivers` n'a PAS de policy UPDATE super-admin (seulement
  // `drivers_update_self`). Un update via la session admin matchait 0 ligne →
  // le gel ne s'appliquait jamais. On passe par le service-role (bypass RLS).
  const admin = createAdminClient();
  const { error, count } = await admin
    .from("drivers")
    .update(
      {
        is_frozen: frozen,
        frozen_at: frozen ? new Date().toISOString() : null,
        freeze_reason: frozen ? (note ?? null) : null,
      },
      { count: "exact" }
    )
    .eq("id", driverId);
  if (error) return { error: error.message };
  if (!count) return { error: "Livreur introuvable." };

  // Gel → sortie IMMÉDIATE de toutes les files de réception (en plus du garde
  // `is_frozen` déjà vérifié dans pull_next_express*/set_driver_availability).
  if (frozen) {
    const { data: mds } = await admin
      .from("merchant_drivers")
      .select("id")
      .eq("driver_id", driverId);
    const ids = (mds ?? []).map((m) => m.id);
    if (ids.length) {
      await admin
        .from("driver_availability")
        .update({ status: "offline" })
        .in("merchant_driver_id", ids)
        .neq("status", "busy"); // on ne casse pas une course en cours
    }
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  await admin.from("admin_audit_log").insert({
    admin_email: user?.email ?? null,
    action: frozen ? "freeze_driver" : "unfreeze_driver",
    target_kind: "driver",
    target_id: driverId,
    note: note ?? null,
  });

  revalidatePath("/admin/drivers");
  revalidatePath(`/admin/drivers/${driverId}`);
  return {};
}

/**
 * BLOCAGE d'un livreur (sanction DURE : dangereux / suspect / violation).
 * Différent du gel : un livreur bloqué n'a PLUS accès à ses pages (juste un
 * message « compte bloqué » + la nav). L'activité est suspendue aussi.
 */
export async function toggleDriverBlocked(
  driverId: string,
  blocked: boolean,
  note?: string
): Promise<{ error?: string }> {
  if (!(await isSuperAdmin())) return { error: "Accès refusé." };

  const admin = createAdminClient();
  const { error, count } = await admin
    .from("drivers")
    .update(
      {
        is_blocked: blocked,
        blocked_at: blocked ? new Date().toISOString() : null,
        block_reason: blocked ? (note ?? null) : null,
      },
      { count: "exact" }
    )
    .eq("id", driverId);
  if (error) return { error: error.message };
  if (!count) return { error: "Livreur introuvable." };

  // Blocage → sortie immédiate des files (en plus du garde is_blocked SQL).
  if (blocked) {
    const { data: mds } = await admin
      .from("merchant_drivers")
      .select("id")
      .eq("driver_id", driverId);
    const ids = (mds ?? []).map((m) => m.id);
    if (ids.length) {
      await admin
        .from("driver_availability")
        .update({ status: "offline" })
        .in("merchant_driver_id", ids)
        .neq("status", "busy");
    }
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // KILL-SWITCH : au blocage, on coupe la session ACTIVE du livreur tout de
  // suite (révocation GoTrue). La RPC est gardée par is_super_admin() côté SQL
  // → on l'appelle avec la SESSION admin (pas le service-role, qui n'a pas de
  // JWT). Best-effort : ne jamais faire échouer le blocage si la révocation
  // rate (le layout `(driver)` bloque déjà l'accès au prochain rendu).
  if (blocked) {
    try {
      const rpc = supabase.rpc.bind(supabase) as unknown as (
        fn: string,
        args: Record<string, unknown>
      ) => Promise<{ data: unknown; error: { message: string } | null }>;
      await rpc("admin_force_driver_signout", { p_driver_id: driverId });
    } catch {
      /* noop : révocation best-effort */
    }
  }

  await admin.from("admin_audit_log").insert({
    admin_email: user?.email ?? null,
    action: blocked ? "block_driver" : "unblock_driver",
    target_kind: "driver",
    target_id: driverId,
    note: note ?? null,
  });

  revalidatePath("/admin/drivers");
  revalidatePath(`/admin/drivers/${driverId}`);
  return {};
}

/**
 * Déconnexion FORCÉE d'un livreur (indépendante du blocage) : révoque ses
 * sessions GoTrue. Utile pour couper un accès suspect / un appareil perdu sans
 * geler ni bloquer le compte.
 */
export async function forceDriverSignout(
  driverId: string
): Promise<{ error?: string; killed?: number }> {
  if (!(await isSuperAdmin())) return { error: "Accès refusé." };
  const supabase = await createClient();
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  const { data, error } = await rpc("admin_force_driver_signout", {
    p_driver_id: driverId,
  });
  if (error) return { error: error.message };
  const res = (data ?? {}) as {
    ok?: boolean;
    reason?: string;
    sessions_killed?: number;
  };
  if (!res.ok) {
    return {
      error:
        res.reason === "no_user" ? "Ce livreur n'a pas de session." : "Échec.",
    };
  }
  const {
    data: { user },
  } = await supabase.auth.getUser();
  await createAdminClient()
    .from("admin_audit_log")
    .insert({
      admin_email: user?.email ?? null,
      action: "force_signout_driver",
      target_kind: "driver",
      target_id: driverId,
      note: `${res.sessions_killed ?? 0} session(s)`,
    });
  return { killed: res.sessions_killed ?? 0 };
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
  const rpc = supabase.rpc.bind(supabase) as unknown as (
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

// =============================================================================
// Pouvoirs super-admin sur les commandes (mig 0097).
// =============================================================================
async function logAdmin(
  supabase: Awaited<ReturnType<typeof createClient>>,
  action: string,
  orderId: string,
  note?: string | null
) {
  try {
    const {
      data: { user },
    } = await supabase.auth.getUser();
    await supabase.from("admin_audit_log").insert({
      admin_email: user?.email ?? null,
      action,
      target_kind: "order",
      target_id: orderId,
      note: note ?? null,
    });
  } catch {
    /* l'audit ne doit jamais faire échouer l'action métier */
  }
}

/** Super-admin valide une livraison (sans code, sans être le livreur). */
export async function adminValidateDelivery(
  orderId: string,
  note?: string
): Promise<AdminFormState> {
  if (!(await isSuperAdmin())) return { error: "Accès refusé." };
  const supabase = await createClient();
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  const { data, error } = await rpc("admin_validate_delivery", {
    p_order_id: orderId,
    p_note: note ?? null,
  });
  if (error) return { error: error.message };
  const row = (Array.isArray(data) ? data[0] : data) as
    | { ok?: boolean; reason?: string | null }
    | undefined;
  if (!row?.ok && row?.reason && row.reason !== "already_delivered") {
    return { error: row.reason };
  }
  await logAdmin(supabase, "validate_delivery", orderId, note);
  revalidatePath("/admin/orders");
  return { ok: true };
}

/** Super-admin annule une commande à n'importe quelle étape (suivi conservé). */
export async function adminCancelOrder(
  orderId: string,
  reason: string
): Promise<AdminFormState> {
  if (!(await isSuperAdmin())) return { error: "Accès refusé." };
  const supabase = await createClient();
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  const { data, error } = await rpc("admin_cancel_order", {
    p_order_id: orderId,
    p_reason: reason ?? null,
  });
  if (error) return { error: error.message };
  const res = (data ?? {}) as {
    ok?: boolean;
    reason?: string;
    merchant_id?: string;
    order_number?: string | null;
    customer_name?: string | null;
  };
  if (!res.ok) {
    return {
      error:
        res.reason === "already_terminal"
          ? "Commande déjà terminée ou annulée."
          : "Annulation impossible.",
    };
  }
  await logAdmin(supabase, "cancel_order", orderId, reason);

  // Notifications best-effort (jamais bloquantes).
  try {
    const { notifyMerchantOrderCancelled, notifyCustomerStatusChange } =
      await import("@/lib/fcm/triggers");
    if (res.merchant_id) {
      await notifyMerchantOrderCancelled({
        merchantId: res.merchant_id,
        orderId,
        orderRef: res.order_number ?? null,
        customerName: res.customer_name ?? null,
      });
    }
    await notifyCustomerStatusChange({ orderId, newStatus: "cancelled" });
  } catch {
    /* noop */
  }

  revalidatePath("/admin/orders");
  return { ok: true };
}

/** Super-admin crédite/rembourse le wallet d'un commerçant pour une commande. */
export async function adminRefundMerchant(
  orderId: string,
  amountDa: number,
  reason: string
): Promise<AdminFormState> {
  if (!(await isSuperAdmin())) return { error: "Accès refusé." };
  const amt = Math.floor(Number(amountDa));
  if (!Number.isFinite(amt) || amt < 1) return { error: "Montant invalide." };
  const supabase = await createClient();
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  const { data, error } = await rpc("admin_refund_merchant_wallet", {
    p_order_id: orderId,
    p_amount_da: amt,
    p_reason: reason ?? null,
  });
  if (error) return { error: error.message };
  const res = (data ?? {}) as { ok?: boolean; reason?: string };
  if (!res.ok) {
    return {
      error:
        res.reason === "already_refunded"
          ? "Cette commande a déjà été remboursée au commerçant."
          : res.reason === "bad_amount"
            ? "Montant invalide."
            : "Remboursement impossible.",
    };
  }
  await logAdmin(supabase, "refund_merchant", orderId, `${amt} DA — ${reason}`);
  revalidatePath("/admin/orders");
  return { ok: true };
}
