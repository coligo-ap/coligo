import { createAdminClient } from "@/lib/supabase/admin";
import { adminCan } from "@/lib/auth/admin";
import type { IdvModeFull, IdvProfileRule } from "./types";

// =============================================================================
// IDV — lectures ADMIN (service_role) pour la console /admin/identite.
// Self-guard systématique : toute fonction vérifie adminCan("confiance") avant
// de lire en bypass RLS (règle projet sur createAdminClient). Non autorisé ⇒
// données vides, jamais d'exception.
// =============================================================================

// Tables idv_* (mig 0367) pas encore dans database.types.ts généré → cast
// local du `from`, comme lib/data/feature-flags.ts.
type AdminFrom = (t: string) => {
  select: (cols: string) => {
    order: (
      col: string,
      opts: { ascending: boolean }
    ) => {
      limit: (n: number) => Promise<{ data: Record<string, unknown>[] | null }>;
    } & Promise<{ data: Record<string, unknown>[] | null }>;
    eq: (
      col: string,
      v: string
    ) => {
      order: (
        col: string,
        opts: { ascending: boolean }
      ) => {
        limit: (
          n: number
        ) => Promise<{ data: Record<string, unknown>[] | null }>;
      };
    };
  };
};

function adminFrom(): AdminFrom {
  const admin = createAdminClient();
  return admin.from.bind(admin) as unknown as AdminFrom;
}

/** TOUS les modes (actifs et désactivés), colonnes complètes (seuils inclus). */
export async function getIdvModesFullAdmin(): Promise<IdvModeFull[]> {
  if (!(await adminCan("confiance"))) return [];
  const { data } = await adminFrom()("idv_modes")
    .select(
      "key, label_fr, label_ar, description_fr, description_ar, position, enabled, max_attempts, checks, policy, face_match_approve, face_match_reject, liveness_min, doc_confidence_min, updated_at, updated_by"
    )
    .order("position", { ascending: true });
  return (data ?? []).map((r) => ({
    ...(r as unknown as IdvModeFull),
    // numeric Postgres → string via PostgREST : re-normalise en nombre.
    face_match_approve: Number(r.face_match_approve),
    face_match_reject: Number(r.face_match_reject),
    liveness_min: Number(r.liveness_min),
    doc_confidence_min: Number(r.doc_confidence_min),
  }));
}

/** Toutes les règles par profil (ordre stable). */
export async function getIdvProfileRulesAdmin(): Promise<IdvProfileRule[]> {
  if (!(await adminCan("confiance"))) return [];
  const { data } = await adminFrom()("idv_profile_rules")
    .select(
      "profile, requirement, allowed_modes, default_mode, user_can_choose_mode"
    )
    .order("profile", { ascending: true });
  return (data ?? []) as unknown as IdvProfileRule[];
}

export type IdvSettingsAuditEntry = {
  id: number;
  actor_email: string | null;
  reason: string | null;
  metadata: {
    table?: string;
    target?: string;
    changes?: Record<string, { from: unknown; to: unknown }>;
  } | null;
  created_at: string;
};

/** Dernières modifications de réglages (journal append-only). */
export async function getIdvSettingsAudit(
  limit = 15
): Promise<IdvSettingsAuditEntry[]> {
  if (!(await adminCan("confiance"))) return [];
  const { data } = await adminFrom()("idv_audit_log")
    .select("id, actor_email, reason, metadata, created_at")
    .eq("action", "settings_updated")
    .order("id", { ascending: false })
    .limit(limit);
  return (data ?? []) as unknown as IdvSettingsAuditEntry[];
}
