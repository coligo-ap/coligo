"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { isSuperAdmin } from "@/lib/auth/admin";
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
