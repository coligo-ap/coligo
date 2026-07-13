// =============================================================================
// IDV — MOTEUR DE DÉCISION pur (zéro dépendance, testable en isolation).
//
// Entrée : les seuils + la policy du mode (table idv_modes, configurés par le
// super-admin) et les résultats bruts du pipeline (scores normalisés [0,1] +
// contrôles individuels). Sortie : 'approve' | 'review' | 'reject' + codes de
// raison stables (traduits par l'UI, jamais de texte libre ici).
//
// Règle produit (spec) :
//   • correspondance élevée  → validation automatique ;
//   • zone intermédiaire     → revue humaine obligatoire (pending_review) ;
//   • correspondance faible  → refus automatique.
// Les échecs annexes (liveness, document illisible/expiré, contrôle en échec)
// réagissent selon la policy du mode ('review' ou 'reject'). Une PANNE
// technique d'un contrôle ne rejette JAMAIS automatiquement : revue humaine.
//
// Testé par scripts/test-idv-core.mjs (npm run test:idv).
// =============================================================================

export type IdvOutcome = "approve" | "review" | "reject";

export type IdvCheckStatus =
  | "passed"
  | "failed"
  | "warning"
  | "skipped"
  | "error";

export type IdvCheckResult = {
  key: string;
  status: IdvCheckStatus;
  score?: number | null;
};

/** Seuils du mode — colonnes de idv_modes, scores normalisés [0,1]. */
export type IdvThresholds = {
  face_match_approve: number;
  face_match_reject: number;
  liveness_min: number;
  doc_confidence_min: number;
};

/** Réaction configurable aux échecs non liés au face match (idv_modes.policy). */
export type IdvPolicy = {
  liveness_fail?: "reject" | "review";
  doc_low_confidence?: "reject" | "review";
  expired_document?: "reject" | "review";
  check_failed?: "reject" | "review";
};

export type IdvScores = {
  face_match?: number | null;
  liveness?: number | null;
  doc_confidence?: number | null;
};

export type IdvDecision = {
  outcome: IdvOutcome;
  /**
   * Codes stables, jamais du texte libre :
   *   all_checks_passed, face_match_low, face_match_uncertain,
   *   face_match_missing, liveness_low, liveness_missing,
   *   doc_confidence_low, document_expired,
   *   check_failed:<key>, check_error:<key>
   */
  reasons: string[];
};

export const IDV_DEFAULT_POLICY: Required<IdvPolicy> = {
  liveness_fail: "review",
  doc_low_confidence: "review",
  expired_document: "reject",
  check_failed: "review",
};

const RANK: Record<IdvOutcome, number> = { approve: 0, review: 1, reject: 2 };

export type DecideIdvInput = {
  thresholds: IdvThresholds;
  policy?: IdvPolicy;
  scores: IdvScores;
  checks?: IdvCheckResult[];
  /** Le document est périmé (date d'expiration extraite < aujourd'hui). */
  documentExpired?: boolean;
  /** Le mode exige un score de liveness : absent ⇒ revue humaine. */
  livenessRequired?: boolean;
};

/**
 * Décision déterministe : on part de 'approve' et chaque anomalie ESCALADE
 * (approve < review < reject) — jamais l'inverse. Toutes les raisons sont
 * accumulées (l'admin voit le tableau complet, pas seulement la pire).
 */
export function decideIdv(input: DecideIdvInput): IdvDecision {
  const { thresholds, scores } = input;
  const policy = { ...IDV_DEFAULT_POLICY, ...input.policy };
  let outcome: IdvOutcome = "approve";
  const reasons: string[] = [];

  const escalate = (to: IdvOutcome, reason: string) => {
    reasons.push(reason);
    if (RANK[to] > RANK[outcome]) outcome = to;
  };

  for (const check of input.checks ?? []) {
    // Panne technique → revue humaine, jamais de refus sur une erreur interne.
    if (check.status === "error")
      escalate("review", `check_error:${check.key}`);
    else if (check.status === "failed")
      escalate(policy.check_failed, `check_failed:${check.key}`);
  }

  if (input.documentExpired)
    escalate(policy.expired_document, "document_expired");

  if (
    scores.doc_confidence != null &&
    scores.doc_confidence < thresholds.doc_confidence_min
  )
    escalate(policy.doc_low_confidence, "doc_confidence_low");

  if (scores.liveness == null) {
    if (input.livenessRequired) escalate("review", "liveness_missing");
  } else if (scores.liveness < thresholds.liveness_min)
    escalate(policy.liveness_fail, "liveness_low");

  // Le face match est TOUJOURS requis : sans lui, pas de décision automatique.
  if (scores.face_match == null) escalate("review", "face_match_missing");
  else if (scores.face_match < thresholds.face_match_reject)
    escalate("reject", "face_match_low");
  else if (scores.face_match < thresholds.face_match_approve)
    escalate("review", "face_match_uncertain");

  if (reasons.length === 0) reasons.push("all_checks_passed");
  return { outcome, reasons };
}
