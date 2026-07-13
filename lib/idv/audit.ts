import { createAdminClient } from "@/lib/supabase/admin";

// =============================================================================
// IDV — journal d'audit (idv_audit_log, APPEND-ONLY par trigger DB).
// Toute action sur un dossier — système, utilisateur ou admin — passe par ici.
// Serveur uniquement (service_role) : ne jamais importer côté client.
// =============================================================================

/** Actions connues (le journal accepte toute chaîne : liste indicative). */
export type IdvAuditAction =
  | "created"
  | "document_uploaded"
  | "document_processed"
  | "selfie_uploaded"
  | "selfie_processed"
  | "auto_approved"
  | "auto_rejected"
  | "sent_to_review"
  | "manual_approved"
  | "manual_rejected"
  | "resubmit_requested"
  | "note_added"
  | "settings_updated"
  | "canceled"
  | (string & {});

export type IdvAuditEntry = {
  verificationId?: string | null;
  actorType: "system" | "user" | "admin";
  actorId?: string | null;
  actorEmail?: string | null;
  action: IdvAuditAction;
  reason?: string | null;
  /** Contexte utile à la traçabilité (scores, seuils appliqués, mode…). */
  metadata?: Record<string, unknown> | null;
};

/**
 * Écrit une entrée d'audit. LÈVE en cas d'échec : une décision sans trace
 * n'est pas acceptable — l'appelant choisit quoi faire (retenter, échouer).
 */
export async function logIdvAudit(entry: IdvAuditEntry): Promise<void> {
  const admin = createAdminClient();
  // idv_audit_log (mig 0367) pas encore dans database.types.ts généré → cast.
  const from = admin.from.bind(admin) as unknown as (t: string) => {
    insert: (
      row: Record<string, unknown>
    ) => Promise<{ error: { message: string } | null }>;
  };
  const { error } = await from("idv_audit_log").insert({
    verification_id: entry.verificationId ?? null,
    actor_type: entry.actorType,
    actor_id: entry.actorId ?? null,
    actor_email: entry.actorEmail ?? null,
    action: entry.action,
    reason: entry.reason ?? null,
    metadata: entry.metadata ?? null,
  });
  if (error) {
    throw new Error(`idv_audit_log : écriture impossible — ${error.message}`);
  }
}
