"use server";

// =============================================================================
// Centre Anti-Fraude — server actions (mig 0373-0374, docs/ANTI-FRAUDE.md).
//
// Chaque action est gardée `adminCan('confiance')` (RBAC par domaine) ET les
// RPC `admin_fraud_*` re-vérifient côté SQL (SECURITY DEFINER + RAISE 42501) :
// défense en profondeur, comme mig 0303.
// =============================================================================

import { revalidatePath } from "next/cache";
import { adminCan } from "@/lib/auth/admin";
import { createClient } from "@/lib/supabase/server";
import { runFraudTick } from "@/lib/fraud/tick";
import type { FraudActionType, FraudActorKind } from "@/lib/fraud/model";

type Res = { ok?: boolean; error?: string };

type Rpc = (
  fn: string,
  args?: Record<string, unknown>
) => Promise<{ data: unknown; error: { message: string } | null }>;

async function rpcClient(): Promise<Rpc> {
  const supabase = await createClient();
  return supabase.rpc.bind(supabase) as unknown as Rpc;
}

function refresh() {
  revalidatePath("/admin/anti-fraude");
  revalidatePath("/admin/anti-fraude/alertes");
  revalidatePath("/admin/anti-fraude/comptes");
}

/** Verdict d'examen d'une alerte — ALIMENTE L'APPRENTISSAGE (poids des règles). */
export async function reviewFraudAlert(input: {
  alertId: string;
  verdict: "confirmed" | "dismissed" | "investigating";
  note?: string | null;
}): Promise<Res> {
  if (!(await adminCan("confiance"))) return { error: "Accès refusé." };
  const rpc = await rpcClient();
  const { data, error } = await rpc("admin_fraud_review_alert", {
    p_alert_id: input.alertId,
    p_verdict: input.verdict,
    p_note: input.note ?? null,
  });
  if (error) return { error: error.message };
  const res = (data ?? {}) as { ok?: boolean; error?: string };
  if (!res.ok) return { error: res.error ?? "Examen impossible." };
  refresh();
  return { ok: true };
}

/** Applique une mesure (réversible, journalisée, notifiée). */
export async function applyFraudAction(input: {
  kind: FraudActorKind;
  actorId: string;
  action: FraudActionType;
  reason: string;
  hours?: number | null;
}): Promise<Res> {
  if (!(await adminCan("confiance"))) return { error: "Accès refusé." };
  const rpc = await rpcClient();
  const { error } = await rpc("admin_fraud_apply_action", {
    p_kind: input.kind,
    p_id: input.actorId,
    p_action: input.action,
    p_reason: input.reason,
    p_hours: input.hours ?? null,
  });
  if (error) return { error: error.message };
  // Envoi immédiat de la notification (cloche + push) sans attendre un battement.
  void runFraudTick();
  refresh();
  revalidatePath(`/admin/anti-fraude/comptes/${input.kind}/${input.actorId}`);
  return { ok: true };
}

/** Révoque une mesure (et annule ses effets de bord). */
export async function revokeFraudAction(input: {
  actionId: string;
  note?: string | null;
}): Promise<Res> {
  if (!(await adminCan("confiance"))) return { error: "Accès refusé." };
  const rpc = await rpcClient();
  const { error } = await rpc("admin_fraud_revoke_action", {
    p_action_id: input.actionId,
    p_note: input.note ?? null,
  });
  if (error) return { error: error.message };
  refresh();
  return { ok: true };
}

/** Met à jour une règle (activation, poids, seuils). */
export async function updateFraudRule(input: {
  code: string;
  enabled?: boolean;
  baseWeight?: number;
  params?: Record<string, unknown>;
}): Promise<Res> {
  if (!(await adminCan("confiance"))) return { error: "Accès refusé." };
  const rpc = await rpcClient();
  const { error } = await rpc("admin_fraud_update_rule", {
    p_code: input.code,
    p_enabled: input.enabled ?? null,
    p_base_weight: input.baseWeight ?? null,
    p_params: input.params ?? null,
  });
  if (error) return { error: error.message };
  revalidatePath("/admin/anti-fraude/regles");
  return { ok: true };
}

/** Met à jour un réglage du moteur (seuils d'automatisation…). */
export async function updateFraudSetting(input: {
  key: string;
  value: unknown;
}): Promise<Res> {
  if (!(await adminCan("confiance"))) return { error: "Accès refusé." };
  const rpc = await rpcClient();
  const { error } = await rpc("admin_fraud_update_setting", {
    p_key: input.key,
    p_value: input.value,
  });
  if (error) return { error: error.message };
  revalidatePath("/admin/anti-fraude/regles");
  return { ok: true };
}
