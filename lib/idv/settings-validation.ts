// =============================================================================
// IDV — VALIDATION des réglages super-admin (pur, zéro dépendance, testé par
// scripts/test-idv-core.mjs). Les server actions parsent le FormData puis
// passent TOUJOURS par ces validateurs : jamais d'écriture non validée, même
// avec le client service_role.
// =============================================================================

// SOURCE UNIQUE des clés de contrôles du pipeline (idv_checks.check_key).
// Définie ICI (module 100 % pur, importable par Node --experimental-strip-types
// qui ne résout pas `./types` sans extension) ; lib/idv/types.ts la ré-exporte.
export const IDV_CHECK_KEYS = [
  "doc_quality",
  "ocr_extract",
  "mrz",
  "doc_expiry",
  "doc_authenticity",
  "selfie_quality",
  "liveness_passive",
  "liveness_active",
  "face_ambiguity",
  "face_match",
  "face_replay",
] as const;

export const IDV_REQUIREMENTS = ["required", "optional", "disabled"] as const;

export const IDV_POLICY_FIELDS = [
  "liveness_fail",
  "doc_low_confidence",
  "expired_document",
  "check_failed",
] as const;
export type IdvPolicyField = (typeof IDV_POLICY_FIELDS)[number];

const POLICY_VALUES = ["reject", "review"] as const;

export type ValidationResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: string };

// ── Règle par profil ─────────────────────────────────────────────────────────

export type ProfileRulePatch = {
  requirement: (typeof IDV_REQUIREMENTS)[number];
  allowed_modes: string[];
  default_mode: string;
  user_can_choose_mode: boolean;
};

/**
 * Valide et NORMALISE une règle de profil. `existingModeKeys` = clés réelles
 * de idv_modes (actifs ou non : on peut préparer une règle sur un mode
 * momentanément désactivé — le parcours utilisateur, lui, croisera avec
 * `enabled`).
 */
export function validateProfileRulePatch(
  input: {
    requirement: unknown;
    allowed_modes: unknown;
    default_mode: unknown;
    user_can_choose_mode: unknown;
  },
  existingModeKeys: string[]
): ValidationResult<ProfileRulePatch> {
  const requirement = String(input.requirement ?? "");
  if (!(IDV_REQUIREMENTS as readonly string[]).includes(requirement)) {
    return { ok: false, error: "Exigence invalide." };
  }

  const raw = Array.isArray(input.allowed_modes) ? input.allowed_modes : [];
  const allowed = [...new Set(raw.map(String))];
  if (allowed.length === 0) {
    return { ok: false, error: "Choisissez au moins un mode autorisé." };
  }
  const unknown = allowed.find((m) => !existingModeKeys.includes(m));
  if (unknown) {
    return { ok: false, error: `Mode inconnu : ${unknown}.` };
  }

  const defaultMode = String(input.default_mode ?? "");
  if (!allowed.includes(defaultMode)) {
    return {
      ok: false,
      error: "Le mode par défaut doit faire partie des modes autorisés.",
    };
  }

  return {
    ok: true,
    value: {
      requirement: requirement as ProfileRulePatch["requirement"],
      allowed_modes: allowed,
      default_mode: defaultMode,
      user_can_choose_mode: input.user_can_choose_mode === true,
    },
  };
}

// ── Mode de vérification ─────────────────────────────────────────────────────

export type ModePatch = {
  enabled: boolean;
  face_match_approve: number;
  face_match_reject: number;
  liveness_min: number;
  doc_confidence_min: number;
  max_attempts: number;
  policy: Record<IdvPolicyField, "reject" | "review">;
  checks: Record<string, boolean>;
};

const KNOWN_CHECKS = IDV_CHECK_KEYS as readonly string[];

function parseScore(v: unknown, label: string): number | string {
  const n = typeof v === "number" ? v : Number(v);
  if (!Number.isFinite(n) || n < 0 || n > 1) {
    return `${label} : valeur attendue entre 0 et 100 %.`;
  }
  return n;
}

/** Valide et NORMALISE la configuration d'un mode (seuils ∈ [0,1]). */
export function validateModePatch(input: {
  enabled: unknown;
  face_match_approve: unknown;
  face_match_reject: unknown;
  liveness_min: unknown;
  doc_confidence_min: unknown;
  max_attempts: unknown;
  policy: unknown;
  checks: unknown;
}): ValidationResult<ModePatch> {
  const approve = parseScore(input.face_match_approve, "Seuil d'approbation");
  if (typeof approve === "string") return { ok: false, error: approve };
  const reject = parseScore(input.face_match_reject, "Seuil de refus");
  if (typeof reject === "string") return { ok: false, error: reject };
  const liveness = parseScore(input.liveness_min, "Seuil de liveness");
  if (typeof liveness === "string") return { ok: false, error: liveness };
  const docMin = parseScore(input.doc_confidence_min, "Seuil de lisibilité");
  if (typeof docMin === "string") return { ok: false, error: docMin };

  if (reject >= approve) {
    return {
      ok: false,
      error:
        "Le seuil de refus doit être STRICTEMENT inférieur au seuil d'approbation (entre les deux = revue humaine).",
    };
  }

  const attempts = Number(input.max_attempts);
  if (!Number.isInteger(attempts) || attempts < 1 || attempts > 10) {
    return { ok: false, error: "Tentatives max : entier entre 1 et 10." };
  }

  const policyIn = (input.policy ?? {}) as Record<string, unknown>;
  const policy = {} as ModePatch["policy"];
  for (const field of IDV_POLICY_FIELDS) {
    const v = String(policyIn[field] ?? "");
    if (!(POLICY_VALUES as readonly string[]).includes(v)) {
      return { ok: false, error: `Réaction invalide pour « ${field} ».` };
    }
    policy[field] = v as "reject" | "review";
  }

  const checksIn = (input.checks ?? {}) as Record<string, unknown>;
  const checks: Record<string, boolean> = {};
  for (const key of Object.keys(checksIn)) {
    if (!KNOWN_CHECKS.includes(key)) {
      return { ok: false, error: `Contrôle inconnu : ${key}.` };
    }
    checks[key] = checksIn[key] === true;
  }
  // Le face match est le cœur du dispositif : jamais désactivable.
  checks.face_match = true;

  return {
    ok: true,
    value: {
      enabled: input.enabled === true,
      face_match_approve: approve,
      face_match_reject: reject,
      liveness_min: liveness,
      doc_confidence_min: docMin,
      max_attempts: attempts,
      policy,
      checks,
    },
  };
}

/** Diff plat old→new pour le journal d'audit ({ champ: { from, to } }). */
export function settingsDiff(
  oldRow: Record<string, unknown>,
  newRow: Record<string, unknown>
): Record<string, { from: unknown; to: unknown }> {
  const out: Record<string, { from: unknown; to: unknown }> = {};
  for (const key of Object.keys(newRow)) {
    const a = oldRow[key];
    const b = newRow[key];
    if (JSON.stringify(a) !== JSON.stringify(b)) {
      out[key] = { from: a ?? null, to: b ?? null };
    }
  }
  return out;
}
