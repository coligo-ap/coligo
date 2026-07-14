import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { logIdvAudit } from "./audit";
import type { IdvProfile } from "./types";

// =============================================================================
// IDV — REPLI MANUEL après un refus automatique (mig 0371).
//
// La machine se trompe : un document abîmé, une photo prise de nuit, un visage
// qui a changé. Un refus automatique ne doit donc jamais être une impasse.
// Cette bascule remet le dossier dans la file de REVUE HUMAINE, avec les
// captures de la tentative, et l'équipe Coligo tranche sur pièces.
//
// ⚠️ Module serveur ORDINAIRE (pas « use server ») : il prend un `userId`, or
// dans un fichier « use server » tout export devient une route appelable — un
// client pourrait viser le dossier d'un AUTRE compte. L'action publique
// (app/idv/actions.ts) résout l'utilisateur depuis la session, puis appelle ceci.
// =============================================================================

type Row = Record<string, unknown>;

function table<T>(t: string): T {
  const admin = createAdminClient();
  return (admin.from.bind(admin) as unknown as (x: string) => T)(t);
}

type LatestSelect = {
  select: (c: string) => {
    eq: (
      c: string,
      v: string
    ) => {
      eq: (
        c: string,
        v: string
      ) => {
        order: (
          c: string,
          o: { ascending: boolean }
        ) => { limit: (n: number) => Promise<{ data: Row[] | null }> };
      };
    };
  };
};

type UpdateById = {
  update: (v: Record<string, unknown>) => {
    eq: (
      c: string,
      v: string
    ) => Promise<{ error: { message: string } | null }>;
  };
};

/**
 * Bascule le DERNIER dossier (refusé) en revue humaine. Idempotent : un dossier
 * déjà basculé renvoie `ok` sans rien réécrire.
 *
 * Le serveur vérifie ce qu'il ne délègue jamais au client : le dossier est bien
 * REFUSÉ (on ne « repasse » pas en manuel une identité déjà vérifiée, ni un
 * dossier déjà en cours d'examen), la décision précédente est effacée (un dossier
 * rouvert n'est plus tranché — sinon les invariants d'intégrité décriraient un
 * état qui n'existe plus), et la bascule laisse une trace au journal d'audit.
 */
export async function openIdvManualFallback(
  userId: string,
  profile: IdvProfile
): Promise<{ ok: boolean; error?: string }> {
  const { data } = await table<LatestSelect>("idv_verifications")
    .select("id, status, manual_fallback")
    .eq("user_id", userId)
    .eq("profile", profile)
    .order("updated_at", { ascending: false })
    .limit(1);

  const latest = data?.[0];
  if (!latest) return { ok: false, error: "Aucun dossier à examiner." };
  if (latest.manual_fallback === true) return { ok: true };
  if (latest.status !== "rejected")
    return {
      ok: false,
      error:
        latest.status === "approved"
          ? "Votre identité est déjà vérifiée."
          : "Votre dossier est déjà en cours d'examen.",
    };

  const { error } = await table<UpdateById>("idv_verifications")
    .update({
      status: "pending_review",
      manual_fallback: true,
      decision: null,
      decision_reason: null,
      decided_at: null,
      decided_by: null,
    })
    .eq("id", String(latest.id));
  if (error) return { ok: false, error: "Bascule impossible. Réessayez." };

  await logIdvAudit({
    verificationId: String(latest.id),
    actorType: "user",
    actorId: userId,
    action: "manual_fallback_requested",
    reason: "auto_rejected_appeal",
    metadata: { profile },
  });
  return { ok: true };
}

/**
 * L'équipe valide le dossier de l'espace (livreur, chauffeur) alors qu'un
 * RECOURS d'identité est en attente ⇒ l'identité est, de fait, vérifiée : les
 * pièces qu'elle vient d'examiner SONT la vérification manuelle.
 *
 * Sans cela, le piège serait le suivant : l'équipe valide le livreur, il ouvre
 * l'application… et l'écran bloquant « vérifiez votre identité » l'attend, parce
 * que son dossier IDV, lui, est resté en attente. Un compte validé qui ne peut
 * pas travailler.
 *
 * Ne touche QUE les dossiers en recours (`manual_fallback`) et en attente : une
 * décision automatique n'est jamais écrasée ici.
 */
export async function settleIdvOnDossierApproval(
  userId: string,
  profile: IdvProfile,
  /** Admin décideur : `id` renseigne decided_by (UUID), `email` le journal. */
  actor: { id: string | null; email: string | null }
): Promise<void> {
  const { data } = await table<LatestSelect>("idv_verifications")
    .select("id, status, manual_fallback")
    .eq("user_id", userId)
    .eq("profile", profile)
    .order("updated_at", { ascending: false })
    .limit(1);

  const latest = data?.[0];
  if (
    !latest ||
    latest.manual_fallback !== true ||
    latest.status !== "pending_review"
  )
    return;

  const now = new Date().toISOString();
  const { error } = await table<UpdateById>("idv_verifications")
    .update({
      status: "approved",
      decision: "manual_approved",
      decision_reason: "dossier validé par l'équipe (examen des pièces)",
      decided_at: now,
      // decided_by est un UUID (auth.users), pas une adresse — piège attrapé par
      // les tests : y écrire un e-mail fait échouer l'INSERT en base.
      decided_by: actor.id,
    })
    .eq("id", String(latest.id));
  if (error) return;

  await logIdvAudit({
    verificationId: String(latest.id),
    actorType: "admin",
    actorId: actor.id,
    actorEmail: actor.email,
    action: "manual_approved",
    reason: "dossier_approved",
    metadata: { profile, via: "dossier_validation" },
  });
}

/** Admin connecté : `id` pour decided_by (UUID), `email` pour le journal. */
export async function currentIdvActor(): Promise<{
  id: string | null;
  email: string | null;
}> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return { id: user?.id ?? null, email: user?.email ?? null };
}
