"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { adminCan } from "@/lib/auth/admin";
import { logIdvAudit } from "@/lib/idv/audit";
import {
  IDV_POLICY_FIELDS,
  settingsDiff,
  validateModePatch,
  validateProfileRulePatch,
} from "@/lib/idv/settings-validation";
import { IDV_CHECK_KEYS } from "@/lib/idv/types";

// =============================================================================
// /admin/identite — actions de PILOTAGE de la vérification d'identité.
// Écritures via service_role (aucune policy RLS sur idv_*), donc DOUBLE
// verrou systématique : adminCan("confiance") + validation pure
// (lib/idv/settings-validation) AVANT toute écriture. Chaque changement réel
// est tracé dans idv_audit_log (append-only) avec le diff old → new.
// =============================================================================

export type AdminFormState = { error?: string; ok?: boolean };

// Tables idv_* pas encore dans database.types.ts généré → casts locaux.
type SelectAll = {
  select: (cols: string) => Promise<{ data: Record<string, unknown>[] | null }>;
};
type SelectOne = {
  select: (cols: string) => {
    eq: (
      c: string,
      v: string
    ) => {
      maybeSingle: () => Promise<{ data: Record<string, unknown> | null }>;
    };
  };
};
type Update = {
  update: (v: Record<string, unknown>) => {
    eq: (
      c: string,
      v: string
    ) => Promise<{ error: { message: string } | null }>;
  };
};

function adminTable<T>(table: string): T {
  const admin = createAdminClient();
  return (admin.from.bind(admin) as unknown as (t: string) => T)(table);
}

async function currentAdmin(): Promise<{
  id: string | null;
  email: string | null;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { id: user?.id ?? null, email: user?.email ?? null };
}

/** Écrit l'entrée d'audit ; l'échec est REMONTÉ à l'admin (traçabilité due). */
async function auditSettings(
  target: string,
  changes: Record<string, { from: unknown; to: unknown }>,
  actor: { id: string | null; email: string | null }
): Promise<string | null> {
  try {
    await logIdvAudit({
      actorType: "admin",
      actorId: actor.id,
      actorEmail: actor.email,
      action: "settings_updated",
      reason: target,
      metadata: { target, changes },
    });
    return null;
  } catch {
    return "Réglage enregistré, mais le journal d'audit n'a pas pu être écrit — refaites la modification pour garantir la traçabilité.";
  }
}

/** Règle d'un profil : exigence, modes autorisés, mode par défaut, libre choix. */
export async function updateIdvProfileRule(
  _prev: AdminFormState,
  formData: FormData
): Promise<AdminFormState> {
  if (!(await adminCan("confiance"))) return { error: "Accès refusé." };

  const profile = String(formData.get("profile") ?? "");
  const { data: modeRows } =
    await adminTable<SelectAll>("idv_modes").select("key");
  const modeKeys = (modeRows ?? []).map((r) => String(r.key));

  const parsed = validateProfileRulePatch(
    {
      requirement: formData.get("requirement"),
      allowed_modes: formData.getAll("allowed_modes").map(String),
      default_mode: formData.get("default_mode"),
      user_can_choose_mode: formData.get("user_can_choose_mode") === "on",
    },
    modeKeys
  );
  if (!parsed.ok) return { error: parsed.error };

  const { data: oldRow } = await adminTable<SelectOne>("idv_profile_rules")
    .select("requirement, allowed_modes, default_mode, user_can_choose_mode")
    .eq("profile", profile)
    .maybeSingle();
  if (!oldRow) return { error: "Profil inconnu." };

  const changes = settingsDiff(oldRow, parsed.value as Record<string, unknown>);
  if (Object.keys(changes).length === 0) return { ok: true };

  const actor = await currentAdmin();
  const { error } = await adminTable<Update>("idv_profile_rules")
    .update({ ...parsed.value, updated_by: actor.id })
    .eq("profile", profile);
  if (error) return { error: `Enregistrement impossible : ${error.message}` };

  const auditError = await auditSettings(
    `idv_profile_rules/${profile}`,
    changes,
    actor
  );
  revalidatePath("/admin/identite");
  return auditError ? { error: auditError } : { ok: true };
}

/** Configuration d'un mode : activation, seuils, policy d'échec, contrôles. */
export async function updateIdvMode(
  _prev: AdminFormState,
  formData: FormData
): Promise<AdminFormState> {
  if (!(await adminCan("confiance"))) return { error: "Accès refusé." };

  const key = String(formData.get("key") ?? "");

  // Les seuils sont saisis en POURCENTS (0–100) → normalisés [0,1].
  const pct = (name: string) => Number(formData.get(name)) / 100;
  const policy: Record<string, unknown> = {};
  for (const field of IDV_POLICY_FIELDS) {
    policy[field] = String(formData.get(`policy_${field}`) ?? "");
  }
  const checks: Record<string, boolean> = {};
  for (const check of IDV_CHECK_KEYS) {
    checks[check] = formData.get(`check_${check}`) === "on";
  }

  const parsed = validateModePatch({
    enabled: formData.get("enabled") === "on",
    face_match_approve: pct("face_match_approve"),
    face_match_reject: pct("face_match_reject"),
    liveness_min: pct("liveness_min"),
    doc_confidence_min: pct("doc_confidence_min"),
    max_attempts: Number(formData.get("max_attempts")),
    policy,
    checks,
  });
  if (!parsed.ok) return { error: parsed.error };

  const { data: oldRaw } = await adminTable<SelectOne>("idv_modes")
    .select(
      "enabled, face_match_approve, face_match_reject, liveness_min, doc_confidence_min, max_attempts, policy, checks"
    )
    .eq("key", key)
    .maybeSingle();
  if (!oldRaw) return { error: "Mode inconnu." };
  // numeric Postgres → string via PostgREST : normalise avant diff.
  const oldRow: Record<string, unknown> = {
    ...oldRaw,
    face_match_approve: Number(oldRaw.face_match_approve),
    face_match_reject: Number(oldRaw.face_match_reject),
    liveness_min: Number(oldRaw.liveness_min),
    doc_confidence_min: Number(oldRaw.doc_confidence_min),
  };

  const changes = settingsDiff(oldRow, parsed.value as Record<string, unknown>);
  if (Object.keys(changes).length === 0) return { ok: true };

  const actor = await currentAdmin();
  const { error } = await adminTable<Update>("idv_modes")
    .update({ ...parsed.value, updated_by: actor.id })
    .eq("key", key);
  if (error) return { error: `Enregistrement impossible : ${error.message}` };

  const auditError = await auditSettings(`idv_modes/${key}`, changes, actor);
  revalidatePath("/admin/identite");
  return auditError ? { error: auditError } : { ok: true };
}
