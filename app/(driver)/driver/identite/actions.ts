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
import { IDV_DEFAULT_POLICY } from "@/lib/idv/decision";
import type {
  AnalyzeDocumentRequest,
  AnalyzeDocumentResponse,
  AnalyzedCheck,
} from "@/lib/idv/pipeline/analyze-contract";

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

type PolicySelect = {
  select: (cols: string) => {
    eq: (
      c: string,
      v: string
    ) => { maybeSingle: () => Promise<{ data: Row | null }> };
  };
};

/** Policy d'échec du mode (colonne cachée aux clients → lecture admin). */
async function loadModePolicy(
  mode: string
): Promise<Record<string, "reject" | "review">> {
  const { data } = await table<PolicySelect>("idv_modes")
    .select("policy")
    .eq("key", mode)
    .maybeSingle();
  return { ...IDV_DEFAULT_POLICY, ...((data?.policy ?? {}) as object) };
}

/**
 * Appelle la route interne d'analyse (la fonction qui embarque les modèles),
 * avec UNE relance. null = pipeline injoignable → l'appelant passe le dossier
 * en revue humaine (jamais bloquer un utilisateur sur une panne).
 */
async function callAnalyzeDocument(
  payload: AnalyzeDocumentRequest
): Promise<Extract<AnalyzeDocumentResponse, { ok: true }> | null> {
  const secret = process.env.INTERNAL_IDV_SECRET;
  if (!secret) return null;
  const base =
    process.env.NODE_ENV === "development"
      ? `http://localhost:${process.env.PORT ?? 3000}`
      : (process.env.NEXT_PUBLIC_APP_URL ??
        `https://${process.env.VERCEL_URL ?? ""}`);
  for (let tries = 0; tries < 2; tries++) {
    try {
      const res = await fetch(`${base}/api/idv/analyze-document`, {
        method: "POST",
        headers: {
          authorization: `Bearer ${secret}`,
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
        signal: AbortSignal.timeout(45_000),
        cache: "no-store",
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const json = (await res.json()) as AnalyzeDocumentResponse;
      if (json.ok) return json;
      throw new Error(json.error);
    } catch {
      /* une relance puis dégradé */
    }
  }
  return null;
}

/** Message inline pour les échecs REPRENABLES (photo à refaire). */
function retryableMessage(
  checks: AnalyzedCheck[],
  mrzFormat: "td1" | "td3" | null
): string {
  const parts: string[] = [];
  for (const c of checks) {
    if (c.key === "mrz") {
      parts.push(
        `Zone MRZ illisible — reprenez la photo${
          mrzFormat === "td1" ? " du verso" : ""
        }, document bien à plat`
      );
    } else if (c.key === "doc_face") {
      parts.push(
        "Portrait introuvable — reprenez le recto, net et sans reflet"
      );
    }
  }
  return parts.join(" · ") || "Document illisible — reprenez les photos";
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

  // TD2 (2×36) : format prévu par le registre mais non implémenté par le
  // parseur (aucun document algérien) → traité comme « sans MRZ ».
  const mrzFormat = docType.mrz_format === "td2" ? null : docType.mrz_format;

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

  // Statut « en place » si la soumission échoue de façon reprenable.
  const keepStatus: IdvStatus =
    existing?.status === "resubmit_document" ? "resubmit_document" : "draft";
  const baseUpdate: Row = {
    document_type: docType.key,
    mode,
    attempt,
    doc_front_path: frontPath,
    doc_back_path: backPath,
  };

  const applyUpdate = async (patch: Row): Promise<boolean> => {
    const { error } = await table<UpdateById>("idv_verifications")
      .update({ ...baseUpdate, ...patch })
      .eq("id", verifId);
    return !error;
  };

  if (!passed) {
    await applyUpdate({ status: keepStatus });
    await logIdvAudit({
      verificationId: verifId,
      actorType: "system",
      action: "document_processed",
      reason: "doc_quality_failed",
      metadata: {
        attempt,
        score,
        front: frontQuality.reasons,
        back: backQuality?.reasons ?? null,
      },
    });
    revalidatePath("/driver/identite");
    return {
      error: qualityMessage(frontQuality, backQuality),
      status: keepStatus,
    };
  }

  // ── Analyse du document (étape 5) : portrait, MRZ + checksums, expiration ─
  const analysis = await callAnalyzeDocument({
    frontPath,
    backPath,
    mrzFormat,
  });

  if (!analysis) {
    // Dégradé : pipeline injoignable → revue humaine, jamais bloquant.
    await applyUpdate({ status: "pending_review" });
    await logIdvAudit({
      verificationId: verifId,
      actorType: "system",
      action: "sent_to_review",
      reason: "pipeline_unavailable",
      metadata: { attempt },
    });
    revalidatePath("/driver/identite");
    return { ok: true, status: "pending_review" };
  }

  for (const c of analysis.checks) {
    await table<PlainInsert>("idv_checks").insert({
      verification_id: verifId,
      attempt,
      check_key: c.key,
      status: c.status,
      score: c.score,
      details: c.details ?? null,
    });
  }

  // Extraction persistée dès qu'elle existe (utile aussi en revue humaine).
  if (analysis.extracted) {
    baseUpdate.extracted = analysis.extracted;
    baseUpdate.document_expires_at = analysis.documentExpiresAt;
  }

  const hardFailures = analysis.checks.filter(
    (c) => c.status === "failed" && !c.retryable
  );
  const technicalErrors = analysis.checks.filter((c) => c.status === "error");
  const retryables = analysis.checks.filter(
    (c) => c.status === "failed" && c.retryable
  );

  // 1) Échec DUR (document expiré / checksums MRZ invalides) → policy du mode.
  if (hardFailures.length > 0) {
    const policy = await loadModePolicy(mode);
    const expired = hardFailures.some((c) => c.key === "doc_expiry");
    const reason = expired ? "document_expired" : "mrz_invalid";
    const action = expired ? policy.expired_document : policy.check_failed;
    if (action === "reject") {
      await applyUpdate({
        status: "rejected",
        decision: "auto_rejected",
        decision_reason: reason,
        decided_at: new Date().toISOString(),
      });
      await logIdvAudit({
        verificationId: verifId,
        actorType: "system",
        action: "auto_rejected",
        reason,
        metadata: { attempt, checks: hardFailures.map((c) => c.key) },
      });
      revalidatePath("/driver/identite");
      return { ok: true, status: "rejected" };
    }
    await applyUpdate({ status: "pending_review" });
    await logIdvAudit({
      verificationId: verifId,
      actorType: "system",
      action: "sent_to_review",
      reason,
      metadata: { attempt, checks: hardFailures.map((c) => c.key) },
    });
    revalidatePath("/driver/identite");
    return { ok: true, status: "pending_review" };
  }

  // 2) Panne technique d'un contrôle → revue humaine, jamais de refus auto.
  if (technicalErrors.length > 0) {
    await applyUpdate({ status: "pending_review" });
    await logIdvAudit({
      verificationId: verifId,
      actorType: "system",
      action: "sent_to_review",
      reason: "technical_error",
      metadata: { attempt, checks: technicalErrors.map((c) => c.key) },
    });
    revalidatePath("/driver/identite");
    return { ok: true, status: "pending_review" };
  }

  // 3) Échec REPRENABLE (MRZ illisible, portrait absent) → photo à refaire.
  if (retryables.length > 0) {
    await applyUpdate({ status: keepStatus });
    await logIdvAudit({
      verificationId: verifId,
      actorType: "system",
      action: "document_processed",
      reason: "retryable_failure",
      metadata: { attempt, checks: retryables.map((c) => c.key) },
    });
    revalidatePath("/driver/identite");
    return {
      error: retryableMessage(retryables, mrzFormat),
      status: keepStatus,
    };
  }

  // 4) Tout est bon → « Document validé ».
  const updated = await applyUpdate({ status: "doc_validated" });
  if (!updated)
    return { error: "Enregistrement du dossier impossible. Réessayez." };
  await logIdvAudit({
    verificationId: verifId,
    actorType: "system",
    action: "document_processed",
    reason: "document_validated",
    metadata: {
      attempt,
      quality: score,
      mrz: docType.mrz_format ? "valid" : "skipped",
    },
  });
  revalidatePath("/driver/identite");
  return { ok: true, status: "doc_validated" };
}
