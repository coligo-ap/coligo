import { createAdminClient } from "@/lib/supabase/admin";
import { adminCan } from "@/lib/auth/admin";
import type {
  IdvModeFull,
  IdvProfileRule,
  IdvStatus,
  IdvVerificationRow,
} from "./types";

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

// ═════════════════════════════════════════════════════════════════════════════
// REVUE HUMAINE (étape 8) — file d'attente + fiche complète d'un dossier.
// Tout passe par service_role (aucune policy RLS sur idv_*), self-gardé par
// adminCan("confiance"). Les captures ne sortent JAMAIS en clair : URLs
// signées courtes générées à la volée sur le bucket privé.
// ═════════════════════════════════════════════════════════════════════════════

const BUCKET = "idv-captures";
/** Durée de vie des liens d'aperçu (le temps d'examiner un dossier). */
const SIGNED_URL_TTL_S = 900;

export type IdvQueueItem = {
  id: string;
  user_id: string;
  profile: string;
  mode: string;
  document_type: string | null;
  status: IdvStatus;
  created_at: string;
  updated_at: string;
  /** Nom lisible du partenaire (livreur), si trouvé. */
  person_name: string | null;
  person_phone: string | null;
  /** Scores clés pour trier l'attention de l'admin. */
  face_match: number | null;
  liveness: number | null;
};

/** File de revue : dossiers en attente (FIFO), enrichis nom + scores. */
export async function getIdvReviewQueue(limit = 50): Promise<IdvQueueItem[]> {
  if (!(await adminCan("confiance"))) return [];
  const admin = createAdminClient();
  const from = admin.from.bind(admin) as unknown as (t: string) => {
    select: (cols: string) => {
      eq: (
        c: string,
        v: string
      ) => {
        order: (
          c: string,
          o: { ascending: boolean }
        ) => {
          limit: (
            n: number
          ) => Promise<{ data: Record<string, unknown>[] | null }>;
        };
      };
      in: (
        c: string,
        v: string[]
      ) => Promise<{ data: Record<string, unknown>[] | null }>;
    };
  };

  const { data: rows } = await from("idv_verifications")
    .select(
      "id, user_id, profile, mode, document_type, status, created_at, updated_at"
    )
    .eq("status", "pending_review")
    .order("created_at", { ascending: true })
    .limit(limit);
  const cases = (rows ?? []) as unknown as IdvQueueItem[];
  if (cases.length === 0) return [];

  // Identités (livreurs) + derniers scores, en 2 requêtes groupées.
  const userIds = [...new Set(cases.map((c) => c.user_id))];
  const ids = cases.map((c) => c.id);
  const [{ data: drivers }, { data: checks }] = await Promise.all([
    from("drivers").select("user_id, full_name, phone").in("user_id", userIds),
    from("idv_checks")
      .select("verification_id, check_key, score, created_at")
      .in("verification_id", ids),
  ]);
  const byUser = new Map(
    (drivers ?? []).map((d) => [
      String(d.user_id),
      {
        name: (d.full_name as string) ?? null,
        phone: (d.phone as string) ?? null,
      },
    ])
  );
  const latest = new Map<
    string,
    { face: number | null; live: number | null }
  >();
  for (const c of (checks ?? []) as Record<string, unknown>[]) {
    const key = String(c.verification_id);
    const entry = latest.get(key) ?? { face: null, live: null };
    if (c.check_key === "face_match" && c.score != null)
      entry.face = Number(c.score);
    if (c.check_key === "liveness_active" && c.score != null)
      entry.live = Number(c.score);
    latest.set(key, entry);
  }

  return cases.map((c) => ({
    ...c,
    person_name: byUser.get(c.user_id)?.name ?? null,
    person_phone: byUser.get(c.user_id)?.phone ?? null,
    face_match: latest.get(c.id)?.face ?? null,
    liveness: latest.get(c.id)?.live ?? null,
  }));
}

export type IdvCaseCheck = {
  id: string;
  attempt: number;
  check_key: string;
  status: "passed" | "failed" | "warning" | "skipped" | "error";
  score: number | null;
  details: Record<string, unknown> | null;
  created_at: string;
};

export type IdvCaseAudit = {
  id: number;
  actor_type: "system" | "user" | "admin";
  actor_email: string | null;
  action: string;
  reason: string | null;
  metadata: Record<string, unknown> | null;
  created_at: string;
};

export type IdvCaseDetail = {
  verification: IdvVerificationRow;
  person: { name: string | null; phone: string | null } | null;
  checks: IdvCaseCheck[];
  audit: IdvCaseAudit[];
  /** Aperçus signés (bucket privé) — null si la capture manque. */
  urls: {
    docFront: string | null;
    docBack: string | null;
    selfie: string | null;
    selfieFrames: string[];
  };
};

/** Fiche complète d'un dossier (revue humaine). null = introuvable/refusé. */
export async function getIdvCaseDetail(
  id: string
): Promise<IdvCaseDetail | null> {
  if (!(await adminCan("confiance"))) return null;
  const admin = createAdminClient();
  const from = admin.from.bind(admin) as unknown as (t: string) => {
    select: (cols: string) => {
      eq: (
        c: string,
        v: string
      ) => {
        maybeSingle: () => Promise<{ data: Record<string, unknown> | null }>;
        order: (
          c: string,
          o: { ascending: boolean }
        ) => Promise<{ data: Record<string, unknown>[] | null }>;
      };
    };
  };

  const { data: verif } = await from("idv_verifications")
    .select("*")
    .eq("id", id)
    .maybeSingle();
  if (!verif) return null;
  const verification = verif as unknown as IdvVerificationRow;

  const [{ data: checks }, { data: audit }, { data: driver }] =
    await Promise.all([
      from("idv_checks")
        .select("id, attempt, check_key, status, score, details, created_at")
        .eq("verification_id", id)
        .order("created_at", { ascending: true }),
      from("idv_audit_log")
        .select(
          "id, actor_type, actor_email, action, reason, metadata, created_at"
        )
        .eq("verification_id", id)
        .order("id", { ascending: false }),
      from("drivers")
        .select("full_name, phone")
        .eq("user_id", verification.user_id)
        .maybeSingle(),
    ]);

  // URLs signées : une seule requête par lot de chemins.
  const sign = async (path: string | null): Promise<string | null> => {
    if (!path) return null;
    const { data } = await admin.storage
      .from(BUCKET)
      .createSignedUrl(path, SIGNED_URL_TTL_S);
    return data?.signedUrl ?? null;
  };
  const frames = Array.isArray(verification.selfie_frames)
    ? verification.selfie_frames
    : [];
  const [docFront, docBack, selfie, ...framesSigned] = await Promise.all([
    sign(verification.doc_front_path),
    sign(verification.doc_back_path),
    sign(verification.selfie_path),
    ...frames.map((f) => sign(f)),
  ]);

  return {
    verification,
    person: driver
      ? {
          name: (driver.full_name as string) ?? null,
          phone: (driver.phone as string) ?? null,
        }
      : null,
    checks: (checks ?? []) as unknown as IdvCaseCheck[],
    audit: (audit ?? []) as unknown as IdvCaseAudit[],
    urls: {
      docFront,
      docBack,
      selfie,
      selfieFrames: framesSigned.filter((u): u is string => Boolean(u)),
    },
  };
}
