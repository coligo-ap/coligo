"use server";

import { revalidatePath } from "next/cache";
import { adminCan } from "@/lib/auth/admin";
import { createAdminClient } from "@/lib/supabase/admin";

// =============================================================================
// Actions Marketing → Roue (mig 0407). Écritures via service_role APRÈS la
// garde adminCan('marketing') — self-guard obligatoire (règle du repo).
// =============================================================================

type ActionResult = { ok: true } | { ok: false; error: string };

function db() {
  const admin = createAdminClient();
  return admin.from.bind(admin) as unknown as (t: string) => {
    update: (v: Record<string, unknown>) => {
      eq: (
        col: string,
        val: string | number
      ) => Promise<{ error: { message: string } | null }>;
    };
    insert: (
      v: Record<string, unknown>
    ) => Promise<{ error: { message: string } | null }>;
    delete: () => {
      eq: (
        col: string,
        val: string
      ) => Promise<{ error: { message: string } | null }>;
    };
  };
}

export async function updateWheelSettings(input: {
  enabled: boolean;
  streak_target: number;
  streak_multiplier: number;
  /** Lot « Livraison offerte » (mig 0421) : validité + plafond financé. */
  free_delivery_valid_days: number;
  free_delivery_max_fee_da: number;
}): Promise<ActionResult> {
  if (!(await adminCan("marketing")))
    return { ok: false, error: "Accès refusé." };
  if (input.streak_target < 2 || input.streak_multiplier < 1) {
    return { ok: false, error: "Valeurs invalides." };
  }
  if (
    input.free_delivery_valid_days < 1 ||
    input.free_delivery_valid_days > 60 ||
    input.free_delivery_max_fee_da < 50
  ) {
    return { ok: false, error: "Réglages livraison offerte invalides." };
  }
  const { error } = await db()("wheel_settings")
    .update({
      enabled: input.enabled,
      streak_target: Math.round(input.streak_target),
      streak_multiplier: Math.round(input.streak_multiplier),
      free_delivery_valid_days: Math.round(input.free_delivery_valid_days),
      free_delivery_max_fee_da: Math.round(input.free_delivery_max_fee_da),
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/marketing/roue");
  return { ok: true };
}

/** Type de lot EXPLICITE (mig 0421) — plus jamais déduit du montant, sinon un
 *  lot « livraison offerte » serait écrasé en « retente ». */
export type WheelPrizeKind = "voucher" | "nothing" | "free_delivery";

function normalizePrize(kindIn: WheelPrizeKind, amountIn: number) {
  const kind: WheelPrizeKind = ["voucher", "nothing", "free_delivery"].includes(
    kindIn
  )
    ? kindIn
    : "nothing";
  // Contrainte DB : (kind='voucher') = (amount_da>0).
  const amount = kind === "voucher" ? Math.max(1, Math.round(amountIn)) : 0;
  return { kind, amount };
}

export async function addWheelPrize(input: {
  kind: WheelPrizeKind;
  amount_da: number;
  weight: number;
  label_fr: string;
  label_ar?: string | null;
}): Promise<ActionResult> {
  if (!(await adminCan("marketing")))
    return { ok: false, error: "Accès refusé." };
  const { kind, amount } = normalizePrize(input.kind, input.amount_da);
  if (input.weight < 1 || !input.label_fr.trim()) {
    return { ok: false, error: "Libellé et poids requis." };
  }
  const { error } = await db()("wheel_prizes").insert({
    kind,
    amount_da: amount,
    weight: Math.round(input.weight),
    label_fr: input.label_fr.trim(),
    label_ar: input.label_ar?.trim() || null,
    position: 99,
  });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/marketing/roue");
  return { ok: true };
}

export async function updateWheelPrize(input: {
  id: string;
  kind: WheelPrizeKind;
  amount_da: number;
  weight: number;
  label_fr: string;
  label_ar?: string | null;
  active: boolean;
}): Promise<ActionResult> {
  if (!(await adminCan("marketing")))
    return { ok: false, error: "Accès refusé." };
  const { kind, amount } = normalizePrize(input.kind, input.amount_da);
  const { error } = await db()("wheel_prizes")
    .update({
      kind,
      amount_da: amount,
      weight: Math.max(1, Math.round(input.weight)),
      label_fr: input.label_fr.trim(),
      label_ar: input.label_ar?.trim() || null,
      active: input.active,
    })
    .eq("id", input.id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/marketing/roue");
  return { ok: true };
}

export async function deleteWheelPrize(id: string): Promise<ActionResult> {
  if (!(await adminCan("marketing")))
    return { ok: false, error: "Accès refusé." };
  const { error } = await db()("wheel_prizes").delete().eq("id", id);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/marketing/roue");
  return { ok: true };
}
