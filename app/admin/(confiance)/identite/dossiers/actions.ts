"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { adminCan } from "@/lib/auth/admin";
import { logIdvAudit } from "@/lib/idv/audit";
import { storeAndPushNotification } from "@/lib/notifications/notify";
import type { IdvStatus } from "@/lib/idv/types";

// =============================================================================
// /admin/identite/dossiers — DÉCISION HUMAINE sur un dossier IDV (étape 8).
// Écritures service_role (aucune policy RLS sur idv_*) → double verrou :
// adminCan("confiance") + transitions GARDÉES (on ne décide que sur un
// dossier réellement en attente). Chaque geste est tracé (idv_audit_log) et
// l'utilisateur est notifié du résultat.
// =============================================================================

export type ReviewState = { error?: string; ok?: boolean };

type Row = Record<string, unknown>;
type SelectOne = {
  select: (cols: string) => {
    eq: (
      c: string,
      v: string
    ) => { maybeSingle: () => Promise<{ data: Row | null }> };
  };
};
type UpdateById = {
  update: (v: Row) => {
    eq: (
      c: string,
      v: string
    ) => Promise<{ error: { message: string } | null }>;
  };
};

function table<T>(t: string): T {
  const admin = createAdminClient();
  return (admin.from.bind(admin) as unknown as (x: string) => T)(t);
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

/** Statuts sur lesquels un admin peut encore agir. */
const DECIDABLE: IdvStatus[] = [
  "pending_review",
  "resubmit_document",
  "resubmit_selfie",
];

/** Charge le dossier et vérifie qu'il est encore décidable. */
async function loadDecidable(
  id: string
): Promise<{ userId: string; status: IdvStatus } | { error: string }> {
  const { data } = await table<SelectOne>("idv_verifications")
    .select("user_id, status")
    .eq("id", id)
    .maybeSingle();
  if (!data) return { error: "Dossier introuvable." };
  const status = data.status as IdvStatus;
  if (!DECIDABLE.includes(status)) {
    return { error: `Dossier déjà clos (${status}) — aucune action possible.` };
  }
  return { userId: String(data.user_id), status };
}

/** Approuver / refuser un dossier (le motif est OBLIGATOIRE au refus). */
export async function decideIdvCase(
  _prev: ReviewState,
  formData: FormData
): Promise<ReviewState> {
  if (!(await adminCan("confiance"))) return { error: "Accès refusé." };

  const id = String(formData.get("id") ?? "");
  const decision = String(formData.get("decision") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (decision !== "approve" && decision !== "reject") {
    return { error: "Décision invalide." };
  }
  if (decision === "reject" && reason.length < 3) {
    return { error: "Indiquez le motif du refus (visible dans le journal)." };
  }

  const loaded = await loadDecidable(id);
  if ("error" in loaded) return { error: loaded.error };

  const actor = await currentAdmin();
  const approved = decision === "approve";
  const { error } = await table<UpdateById>("idv_verifications")
    .update({
      status: approved ? "approved" : "rejected",
      decision: approved ? "manual_approved" : "manual_rejected",
      decision_reason: reason.slice(0, 500) || (approved ? "manual_ok" : null),
      decided_at: new Date().toISOString(),
      decided_by: actor.id,
    })
    .eq("id", id);
  if (error) return { error: `Enregistrement impossible : ${error.message}` };

  await logIdvAudit({
    verificationId: id,
    actorType: "admin",
    actorId: actor.id,
    actorEmail: actor.email,
    action: approved ? "manual_approved" : "manual_rejected",
    reason: reason.slice(0, 500) || null,
    metadata: { previous_status: loaded.status },
  });
  await storeAndPushNotification({
    userId: loaded.userId,
    audience: "driver",
    kind: approved ? "idv_approved" : "idv_rejected",
    title: approved ? "Identité vérifiée" : "Vérification refusée",
    body: approved
      ? "Votre identité a été confirmée par l'équipe Coligo."
      : "Votre identité n'a pas pu être confirmée. Contactez le support.",
    route: "/driver/identite",
  });

  revalidatePath("/admin/identite/dossiers");
  revalidatePath(`/admin/identite/dossiers/${id}`);
  return { ok: true };
}

/** Redemander une pièce : nouveau document OU nouveau selfie. */
export async function requestIdvResubmit(
  _prev: ReviewState,
  formData: FormData
): Promise<ReviewState> {
  if (!(await adminCan("confiance"))) return { error: "Accès refusé." };

  const id = String(formData.get("id") ?? "");
  const what = String(formData.get("what") ?? "");
  const reason = String(formData.get("reason") ?? "").trim();
  if (what !== "document" && what !== "selfie") {
    return { error: "Demande invalide." };
  }
  if (reason.length < 3) {
    return { error: "Expliquez ce qui ne va pas (message vu par le livreur)." };
  }

  const loaded = await loadDecidable(id);
  if ("error" in loaded) return { error: loaded.error };

  const actor = await currentAdmin();
  const status: IdvStatus =
    what === "document" ? "resubmit_document" : "resubmit_selfie";
  const { error } = await table<UpdateById>("idv_verifications")
    .update({ status })
    .eq("id", id);
  if (error) return { error: `Enregistrement impossible : ${error.message}` };

  await logIdvAudit({
    verificationId: id,
    actorType: "admin",
    actorId: actor.id,
    actorEmail: actor.email,
    action: "resubmit_requested",
    reason: reason.slice(0, 500),
    metadata: { what, previous_status: loaded.status },
  });
  await storeAndPushNotification({
    userId: loaded.userId,
    audience: "driver",
    kind: "idv_resubmit",
    title:
      what === "document"
        ? "Nouveau document demandé"
        : "Nouveau selfie demandé",
    body: reason.slice(0, 160),
    route: "/driver/identite",
  });

  revalidatePath("/admin/identite/dossiers");
  revalidatePath(`/admin/identite/dossiers/${id}`);
  return { ok: true };
}

/** Commentaire interne (jamais visible par l'utilisateur). */
export async function addIdvNote(
  _prev: ReviewState,
  formData: FormData
): Promise<ReviewState> {
  if (!(await adminCan("confiance"))) return { error: "Accès refusé." };

  const id = String(formData.get("id") ?? "");
  const note = String(formData.get("note") ?? "").trim();
  if (note.length < 2) return { error: "Note vide." };

  const actor = await currentAdmin();
  try {
    await logIdvAudit({
      verificationId: id,
      actorType: "admin",
      actorId: actor.id,
      actorEmail: actor.email,
      action: "note_added",
      reason: note.slice(0, 1000),
      metadata: { internal: true },
    });
  } catch {
    return { error: "Note non enregistrée. Réessayez." };
  }
  revalidatePath(`/admin/identite/dossiers/${id}`);
  return { ok: true };
}
