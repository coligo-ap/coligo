// =============================================================================
// IDV — types du domaine « vérification d'identité » (tables idv_*, mig 0367).
// Partagés par le parcours utilisateur, le pipeline serveur et la console
// super-admin. Les types du moteur de décision vivent dans ./decision.ts.
// =============================================================================

/** Statuts du dossier (idv_verifications.status). */
export const IDV_STATUSES = [
  "draft",
  "doc_processing",
  "doc_validated",
  "selfie_processing",
  "pending_review",
  "approved",
  "rejected",
  "resubmit_document",
  "resubmit_selfie",
  "canceled",
  "expired",
] as const;
export type IdvStatus = (typeof IDV_STATUSES)[number];

/** Libellés FR courts (réutilisés parcours + admin). */
export const IDV_STATUS_LABELS_FR: Record<IdvStatus, string> = {
  draft: "À compléter",
  doc_processing: "Document en cours d'analyse",
  doc_validated: "Document validé",
  selfie_processing: "Selfie en cours d'analyse",
  pending_review: "Vérification manuelle en cours",
  approved: "Identité vérifiée",
  rejected: "Vérification refusée",
  resubmit_document: "Nouveau document demandé",
  resubmit_selfie: "Nouveau selfie demandé",
  canceled: "Annulée",
  expired: "Expirée",
};

/** Mêmes libellés, en arabe (parcours livreur/chauffeur bilingues). */
export const IDV_STATUS_LABELS_AR: Record<IdvStatus, string> = {
  draft: "بحاجة إلى استكمال",
  doc_processing: "الوثيقة قيد التحليل",
  doc_validated: "تم قبول الوثيقة",
  selfie_processing: "السيلفي قيد التحليل",
  pending_review: "تحقّق يدوي قيد الإنجاز",
  approved: "تم التحقّق من الهوية",
  rejected: "رُفض التحقّق",
  resubmit_document: "مطلوب وثيقة جديدة",
  resubmit_selfie: "مطلوب سيلفي جديد",
  canceled: "أُلغي",
  expired: "انتهت صلاحيته",
};

/** Libellé d'état selon la locale (« ar » → arabe, sinon français). */
export function idvStatusLabel(status: IdvStatus, locale?: string): string {
  const map = locale === "ar" ? IDV_STATUS_LABELS_AR : IDV_STATUS_LABELS_FR;
  return map[status] ?? status;
}

/** Statuts « vivants » : un seul dossier de ce genre par (user, profil). */
export const IDV_ACTIVE_STATUSES: IdvStatus[] = [
  "draft",
  "doc_processing",
  "doc_validated",
  "selfie_processing",
  "pending_review",
  "resubmit_document",
  "resubmit_selfie",
];

/** Exigence par profil (idv_profile_rules.requirement). */
export type IdvRequirement = "required" | "optional" | "disabled";

/** Profils connus — extensible : toute nouvelle catégorie = une ligne de règle. */
export type IdvProfile = "driver" | "chauffeur" | "merchant" | (string & {});

/** Vue PUBLIQUE d'un mode (colonnes accordées aux utilisateurs connectés —
 *  les seuils et la policy ne sortent JAMAIS côté client). */
export type IdvModePublic = {
  key: string;
  label_fr: string;
  label_ar: string | null;
  description_fr: string | null;
  description_ar: string | null;
  position: number;
  enabled: boolean;
  max_attempts: number;
};

/** Vue COMPLÈTE d'un mode (service_role / console admin uniquement). */
export type IdvModeFull = IdvModePublic & {
  checks: Record<string, boolean>;
  policy: Record<string, "reject" | "review">;
  face_match_approve: number;
  face_match_reject: number;
  liveness_min: number;
  doc_confidence_min: number;
  updated_at: string;
  updated_by: string | null;
};

export type IdvProfileRule = {
  profile: IdvProfile;
  requirement: IdvRequirement;
  allowed_modes: string[];
  default_mode: string;
  user_can_choose_mode: boolean;
};

export type IdvDocumentType = {
  key: string;
  country: string;
  label_fr: string;
  label_ar: string | null;
  sides: 1 | 2;
  mrz_format: "td1" | "td2" | "td3" | null;
  enabled: boolean;
  position: number;
  expected_fields: string[];
};

/** Résultat de la porte d'entrée : la vérification s'applique-t-elle à ce
 *  profil, et sous quelles règles ? (kill-switch global + règle par profil). */
export type IdvGate = {
  /** Parcours proposable à l'utilisateur (flag publié + profil non désactivé). */
  enabled: boolean;
  requirement: IdvRequirement;
  allowedModes: string[];
  defaultMode: string;
  userCanChooseMode: boolean;
};

/** Clés de contrôles connues du pipeline (idv_checks.check_key) — la SOURCE
 *  vit dans settings-validation.ts (module pur), ré-exportée ici. */
import { IDV_CHECK_KEYS } from "./settings-validation";

export { IDV_CHECK_KEYS };
export type IdvCheckKey = (typeof IDV_CHECK_KEYS)[number] | (string & {});

/** Libellés FR des contrôles (console admin + détails de dossier). */
export const IDV_CHECK_LABELS_FR: Record<
  (typeof IDV_CHECK_KEYS)[number],
  string
> = {
  doc_quality: "Qualité de l'image",
  ocr_extract: "Extraction OCR",
  mrz: "MRZ + sommes de contrôle",
  doc_expiry: "Expiration du document",
  doc_authenticity: "Authenticité renforcée",
  selfie_quality: "Qualité du selfie (netteté, cadrage)",
  liveness_passive: "Présence réelle (passif)",
  liveness_active: "Présence réelle (défis)",
  face_ambiguity: "Un seul visage dans le cadre",
  face_match: "Comparaison du visage",
  face_replay: "Selfie ≠ photo du document",
};

/** Ligne dossier (accès service_role uniquement — jamais renvoyée brute au
 *  client : les server actions projettent les champs affichables). */
export type IdvVerificationRow = {
  id: string;
  user_id: string;
  profile: IdvProfile;
  mode: string;
  document_type: string | null;
  status: IdvStatus;
  attempt: number;
  /** Dossier REFUSÉ par la machine puis confié à l'équipe (recours, mig 0371) :
   *  il se juge sur pièces, il n'a donc aucun score de comparaison des visages. */
  manual_fallback: boolean;
  doc_front_path: string | null;
  doc_back_path: string | null;
  selfie_path: string | null;
  selfie_frames: string[] | null;
  extracted: Record<string, unknown> | null;
  scores: {
    face_match?: number;
    liveness?: number;
    doc_confidence?: number;
  } | null;
  document_expires_at: string | null;
  decision:
    | "auto_approved"
    | "auto_rejected"
    | "manual_approved"
    | "manual_rejected"
    | null;
  decision_reason: string | null;
  decided_at: string | null;
  decided_by: string | null;
  created_at: string;
  updated_at: string;
};
