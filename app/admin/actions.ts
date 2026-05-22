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

  revalidatePath("/admin/merchants");
  return {};
}
