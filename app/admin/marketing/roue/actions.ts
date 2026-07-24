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
}): Promise<ActionResult> {
  if (!(await adminCan("marketing")))
    return { ok: false, error: "Accès refusé." };
  if (input.streak_target < 2 || input.streak_multiplier < 1) {
    return { ok: false, error: "Valeurs invalides." };
  }
  const { error } = await db()("wheel_settings")
    .update({
      enabled: input.enabled,
      streak_target: Math.round(input.streak_target),
      streak_multiplier: Math.round(input.streak_multiplier),
      updated_at: new Date().toISOString(),
    })
    .eq("id", 1);
  if (error) return { ok: false, error: error.message };
  revalidatePath("/admin/marketing/roue");
  return { ok: true };
}

export async function addWheelPrize(input: {
  amount_da: number;
  weight: number;
  label_fr: string;
  label_ar?: string | null;
}): Promise<ActionResult> {
  if (!(await adminCan("marketing")))
    return { ok: false, error: "Accès refusé." };
  const amount = Math.round(input.amount_da);
  const kind = amount > 0 ? "voucher" : "nothing";
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
  amount_da: number;
  weight: number;
  label_fr: string;
  label_ar?: string | null;
  active: boolean;
}): Promise<ActionResult> {
  if (!(await adminCan("marketing")))
    return { ok: false, error: "Accès refusé." };
  const amount = Math.round(input.amount_da);
  const { error } = await db()("wheel_prizes")
    .update({
      kind: amount > 0 ? "voucher" : "nothing",
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
