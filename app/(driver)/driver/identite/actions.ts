"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  validateUploadedFile,
  MB,
  type ValidatedFile,
} from "@/lib/security/file-validation";
import { getIdvDocumentTypes, getIdvGate, getIdvModes } from "@/lib/idv/config";
import {
  assessDocQuality,
  DOC_QUALITY_REASONS_FR,
  type DocQuality,
} from "@/lib/idv/pipeline/quality";
import { logIdvAudit } from "@/lib/idv/audit";
import { IDV_ACTIVE_STATUSES, type IdvStatus } from "@/lib/idv/types";

// =============================================================================
// /driver/identite — SOUMISSION du document d'identité (étape 4 du chantier
// IDV, docs/IDV-KYC.md). Le client guide la prise de vue ; ICI on refait les
// contrôles qui font foi : magic bytes, qualité photo (netteté/exposition/
// reflets), tentatives bornées. Écritures via service_role (aucune policy RLS
// sur idv_*) → session vérifiée + périmètre user_id systématique.
// OCR / MRZ / authenticité brancheront leurs contrôles au MÊME endroit
// (étape 5) avant le passage à `doc_validated`.
// =============================================================================

const PROFILE = "driver";
const BUCKET = "idv-captures";
const MAX_DOC_BYTES = 8 * MB;

export type IdvSubmitState = {
  error?: string;
  ok?: boolean;
  status?: IdvStatus;
};

// Tables idv_* pas encore dans database.types.ts généré → casts locaux.
type Row = Record<string, unknown>;
type ActiveSelect = {
  select: (cols: string) => {
    eq: (
      c: string,
      v: string
    ) => {
      eq: (
        c: string,
        v: string
      ) => {
        in: (
          c: string,
          v: readonly string[]
        ) => { maybeSingle: () => Promise<{ data: Row | null }> };
      };
    };
  };
};
type InsertReturning = {
  insert: (v: Row) => {
    select: (cols: string) => {
      single: () => Promise<{
        data: Row | null;
        error: { message: string } | null;
      }>;
    };
  };
};
type PlainInsert = {
  insert: (v: Row) => Promise<{ error: { message: string } | null }>;
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

function qualityMessage(front: DocQuality, back: DocQuality | null): string {
  const parts: string[] = [];
  if (front.verdict === "failed") {
    parts.push(
      (back ? "Recto : " : "") + DOC_QUALITY_REASONS_FR[front.reasons[0]]
    );
  }
  if (back && back.verdict === "failed") {
    parts.push("Verso : " + DOC_QUALITY_REASONS_FR[back.reasons[0]]);
  }
  return parts.join(" · ");
}

export async function submitIdvDocument(
  _prev: IdvSubmitState,
  formData: FormData
): Promise<IdvSubmitState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expirée — reconnectez-vous." };

  const gate = await getIdvGate(PROFILE);
  if (!gate.enabled) {
    return { error: "La vérification d'identité n'est pas disponible." };
  }

  // ── Type de document + mode (toujours revalidés serveur) ─────────────────
  const docTypes = await getIdvDocumentTypes();
  const docType = docTypes.find(
    (d) => d.key === String(formData.get("document_type") ?? "")
  );
  if (!docType) return { error: "Type de document invalide." };

  const enabledModes = await getIdvModes();
  const candidates = gate.allowedModes.filter((m) =>
    enabledModes.some((e) => e.key === m)
  );
  if (candidates.length === 0) {
    return { error: "Aucun mode de vérification disponible." };
  }
  const requested = String(formData.get("mode") ?? "");
  const mode =
    gate.userCanChooseMode && candidates.includes(requested)
      ? requested
      : candidates.includes(gate.defaultMode)
        ? gate.defaultMode
        : candidates[0];
  const maxAttempts =
    enabledModes.find((m) => m.key === mode)?.max_attempts ?? 3;

  // ── Fichiers : magic bytes serveur, jamais file.type ──────────────────────
  const front = await validateUploadedFile(formData.get("doc_front"), {
    kind: "image",
    maxBytes: MAX_DOC_BYTES,
  });
  if (!front.ok) return { error: `Recto — ${front.error}` };
  let back: ValidatedFile | null = null;
  if (docType.sides === 2) {
    const b = await validateUploadedFile(formData.get("doc_back"), {
      kind: "image",
      maxBytes: MAX_DOC_BYTES,
    });
    if (!b.ok) return { error: `Verso — ${b.error}` };
    back = b;
  }

  // ── Dossier actif : reprise ou création ───────────────────────────────────
  const { data: existing } = await table<ActiveSelect>("idv_verifications")
    .select("id, status, attempt")
    .eq("user_id", user.id)
    .eq("profile", PROFILE)
    .in("status", IDV_ACTIVE_STATUSES)
    .maybeSingle();

  if (
    existing &&
    existing.status !== "draft" &&
    existing.status !== "resubmit_document"
  ) {
    return {
      error: "Un dossier est déjà en cours pour ce compte.",
      status: existing.status as IdvStatus,
    };
  }

  let verifId: string;
  let attempt: number;
  if (existing) {
    verifId = String(existing.id);
    attempt = Number(existing.attempt) + 1;
  } else {
    const { data: created, error: insErr } = await table<InsertReturning>(
      "idv_verifications"
    )
      .insert({
        user_id: user.id,
        profile: PROFILE,
        mode,
        document_type: docType.key,
      })
      .select("id, attempt")
      .single();
    if (insErr || !created) {
      return { error: "Impossible d'ouvrir le dossier. Réessayez." };
    }
    verifId = String(created.id);
    attempt = Number(created.attempt); // 1
  }

  // ── Tentatives bornées (anti-abus) : au-delà → revue humaine ─────────────
  if (attempt > maxAttempts) {
    await table<UpdateById>("idv_verifications")
      .update({ status: "pending_review" })
      .eq("id", verifId);
    await logIdvAudit({
      verificationId: verifId,
      actorType: "system",
      action: "sent_to_review",
      reason: "max_attempts_reached",
      metadata: { attempt, maxAttempts },
    });
    revalidatePath("/driver/identite");
    return { ok: true, status: "pending_review" };
  }

  // ── Upload bucket privé (chemins générés, extension vérifiée) ────────────
  const admin = createAdminClient();
  const base = `${user.id}/${verifId}/${attempt}`;
  const frontPath = `${base}-front.${front.ext}`;
  const { error: upFrontErr } = await admin.storage
    .from(BUCKET)
    .upload(frontPath, front.bytes, { contentType: front.mime, upsert: true });
  if (upFrontErr) return { error: "Envoi du recto impossible. Réessayez." };
  let backPath: string | null = null;
  if (back) {
    backPath = `${base}-back.${back.ext}`;
    const { error: upBackErr } = await admin.storage
      .from(BUCKET)
      .upload(backPath, back.bytes, { contentType: back.mime, upsert: true });
    if (upBackErr) return { error: "Envoi du verso impossible. Réessayez." };
  }
  await logIdvAudit({
    verificationId: verifId,
    actorType: "user",
    actorId: user.id,
    action: "document_uploaded",
    metadata: { attempt, document_type: docType.key, sides: docType.sides },
  });

  // ── Qualité photo : le verdict SERVEUR fait foi ───────────────────────────
  const frontQuality = await assessDocQuality(Buffer.from(front.bytes));
  const backQuality = back
    ? await assessDocQuality(Buffer.from(back.bytes))
    : null;
  const passed =
    frontQuality.verdict === "passed" &&
    (!backQuality || backQuality.verdict === "passed");
  const score = Math.min(frontQuality.score, backQuality?.score ?? 1);

  await table<PlainInsert>("idv_checks").insert({
    verification_id: verifId,
    attempt,
    check_key: "doc_quality",
    status: passed ? "passed" : "failed",
    score,
    details: { front: frontQuality, back: backQuality },
  });

  const nextStatus: IdvStatus = passed
    ? "doc_validated"
    : existing?.status === "resubmit_document"
      ? "resubmit_document"
      : "draft";
  const { error: updErr } = await table<UpdateById>("idv_verifications")
    .update({
      document_type: docType.key,
      mode,
      attempt,
      doc_front_path: frontPath,
      doc_back_path: backPath,
      status: nextStatus,
    })
    .eq("id", verifId);
  if (updErr)
    return { error: "Enregistrement du dossier impossible. Réessayez." };

  await logIdvAudit({
    verificationId: verifId,
    actorType: "system",
    action: "document_processed",
    reason: passed ? "doc_quality_passed" : "doc_quality_failed",
    metadata: {
      attempt,
      score,
      front: frontQuality.reasons,
      back: backQuality?.reasons ?? null,
    },
  });

  revalidatePath("/driver/identite");
  if (!passed) {
    return {
      error: qualityMessage(frontQuality, backQuality),
      status: nextStatus,
    };
  }
  return { ok: true, status: "doc_validated" };
}
