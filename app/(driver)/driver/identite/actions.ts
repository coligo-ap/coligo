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
import {
  CHALLENGE_TTL_MS,
  drawChallenges,
  embeddingCosine,
  evaluateLiveness,
  FRAME_CONSISTENCY_MIN,
  issueChallengeToken,
  verifyChallengeToken,
  IDV_CHALLENGES,
  type IdvChallenge,
} from "@/lib/idv/liveness";
import type {
  AnalyzeDocumentRequest,
  AnalyzeDocumentResponse,
  AnalyzedCheck,
  AnalyzeSelfieRequest,
  AnalyzeSelfieResponse,
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

/** Paramètres de décision du mode (colonnes cachées aux clients → admin). */
async function loadModeParams(mode: string): Promise<{
  policy: Record<string, "reject" | "review">;
  livenessMin: number;
}> {
  const { data } = await table<PolicySelect>("idv_modes")
    .select("policy, liveness_min")
    .eq("key", mode)
    .maybeSingle();
  return {
    policy: { ...IDV_DEFAULT_POLICY, ...((data?.policy ?? {}) as object) },
    livenessMin: Number(data?.liveness_min ?? 0.7),
  };
}

/**
 * Appelle une route interne d'analyse (la fonction qui embarque les modèles),
 * avec UNE relance. null = pipeline injoignable → l'appelant passe le dossier
 * en revue humaine (jamais bloquer un utilisateur sur une panne).
 */
async function callIdvApi<T extends { ok: boolean }>(
  route: string,
  payload: unknown
): Promise<Extract<T, { ok: true }> | null> {
  const secret = process.env.INTERNAL_IDV_SECRET;
  if (!secret) return null;
  const base =
    process.env.NODE_ENV === "development"
      ? `http://localhost:${process.env.PORT ?? 3000}`
      : (process.env.NEXT_PUBLIC_APP_URL ??
        `https://${process.env.VERCEL_URL ?? ""}`);
  for (let tries = 0; tries < 2; tries++) {
    try {
      const res = await fetch(`${base}/api/idv/${route}`, {
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
      const json = (await res.json()) as T;
      if (json.ok) return json as Extract<T, { ok: true }>;
      throw new Error((json as { error?: string }).error);
    } catch {
      /* une relance puis dégradé */
    }
  }
  return null;
}

const callAnalyzeDocument = (payload: AnalyzeDocumentRequest) =>
  callIdvApi<AnalyzeDocumentResponse>("analyze-document", payload);
const callAnalyzeSelfie = (payload: AnalyzeSelfieRequest) =>
  callIdvApi<AnalyzeSelfieResponse>("analyze-selfie", payload);

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
    const { policy } = await loadModeParams(mode);
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

// ═════════════════════════════════════════════════════════════════════════════
// SELFIE + LIVENESS ACTIF (étape 6) — défis émis et jugés PAR LE SERVEUR.
// ═════════════════════════════════════════════════════════════════════════════

type CountSelect = {
  select: (
    cols: string,
    opts: { count: "exact"; head: true }
  ) => {
    eq: (
      c: string,
      v: string
    ) => {
      eq: (c: string, v: string) => Promise<{ count: number | null }>;
    };
  };
};

export type IdvSelfieSession =
  | { error: string }
  | { challenges: IdvChallenge[]; token: string; expiresAt: number };

/** Ouvre une session de défis liveness (jeton HMAC à expiration courte). */
export async function startIdvSelfie(): Promise<IdvSelfieSession> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expirée — reconnectez-vous." };
  const gate = await getIdvGate(PROFILE);
  if (!gate.enabled) return { error: "Vérification indisponible." };
  const secret = process.env.INTERNAL_IDV_SECRET;
  if (!secret) return { error: "Vérification indisponible." };

  const { data: verif } = await table<ActiveSelect>("idv_verifications")
    .select("id, status")
    .eq("user_id", user.id)
    .eq("profile", PROFILE)
    .in("status", IDV_ACTIVE_STATUSES)
    .maybeSingle();
  if (
    !verif ||
    (verif.status !== "doc_validated" && verif.status !== "resubmit_selfie")
  ) {
    return { error: "Validez d'abord votre document." };
  }

  const challenges = drawChallenges();
  const expiresAt = Date.now() + CHALLENGE_TTL_MS;
  const token = issueChallengeToken(
    secret,
    String(verif.id),
    challenges,
    expiresAt
  );
  return { challenges, token, expiresAt };
}

/** Message de coaching pour un échec REPRENABLE de liveness. */
function livenessCoaching(reasons: (string | null)[]): string {
  const map: Record<string, string> = {
    no_face: "Visage non détecté — placez-vous face caméra, en pleine lumière",
    face_off_center: "Placez votre visage dans l'ovale",
    face_too_small: "Rapprochez le téléphone de votre visage",
    head_turn_not_detected: "Tournez davantage la tête au moment demandé",
    not_closer: "Rapprochez davantage le téléphone quand c'est demandé",
    eye_distance_collapsed: "Gardez le téléphone bien face à vous",
    no_reference: "Recommencez le selfie depuis le début",
  };
  for (const r of reasons) if (r && map[r]) return map[r];
  return "Selfie non conforme — recommencez en suivant les consignes";
}

export async function submitIdvSelfie(
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
  const secret = process.env.INTERNAL_IDV_SECRET;
  if (!secret) return { error: "Vérification indisponible." };

  const { data: verif } = await table<ActiveSelect>("idv_verifications")
    .select("id, status, mode")
    .eq("user_id", user.id)
    .eq("profile", PROFILE)
    .in("status", IDV_ACTIVE_STATUSES)
    .maybeSingle();
  if (
    !verif ||
    (verif.status !== "doc_validated" && verif.status !== "resubmit_selfie")
  ) {
    return {
      error: "Dossier non prêt pour le selfie.",
      status: verif?.status as IdvStatus | undefined,
    };
  }
  const verifId = String(verif.id);
  const keepStatus = verif.status as IdvStatus;

  // ── Session de défis : jeton HMAC vérifié (anti-rejeu, anti-bricolage) ────
  const challenges = String(formData.get("challenges") ?? "")
    .split(",")
    .filter(Boolean) as IdvChallenge[];
  const expiresAt = Number(formData.get("expires_at"));
  const token = String(formData.get("token") ?? "");
  if (
    challenges.some((c) => !IDV_CHALLENGES.includes(c)) ||
    !verifyChallengeToken(secret, token, verifId, challenges, expiresAt)
  ) {
    return { error: "Session de vérification expirée — relancez le selfie." };
  }

  // ── Tentatives selfie bornées (comptées sur les contrôles liveness) ──────
  const enabledModes = await getIdvModes();
  const maxAttempts =
    enabledModes.find((m) => m.key === verif.mode)?.max_attempts ?? 3;
  const { count } = await table<CountSelect>("idv_checks")
    .select("*", { count: "exact", head: true })
    .eq("verification_id", verifId)
    .eq("check_key", "liveness_active");
  const selfieAttempt = (count ?? 0) + 1;
  const applyStatus = async (patch: Row) =>
    table<UpdateById>("idv_verifications").update(patch).eq("id", verifId);

  if (selfieAttempt > maxAttempts) {
    await applyStatus({ status: "pending_review" });
    await logIdvAudit({
      verificationId: verifId,
      actorType: "system",
      action: "sent_to_review",
      reason: "max_selfie_attempts_reached",
      metadata: { selfieAttempt, maxAttempts },
    });
    revalidatePath("/driver/identite");
    return { ok: true, status: "pending_review" };
  }

  // ── Frames : magic bytes + upload bucket privé ────────────────────────────
  const paths: string[] = [];
  for (let i = 0; i < challenges.length; i++) {
    const v = await validateUploadedFile(formData.get(`frame_${i}`), {
      kind: "image",
      maxBytes: 4 * MB,
    });
    if (!v.ok) return { error: `Image ${i + 1} — ${v.error}` };
    const path = `${user.id}/${verifId}/selfie-${selfieAttempt}-${i}.${v.ext}`;
    const admin = createAdminClient();
    const { error: upErr } = await admin.storage
      .from(BUCKET)
      .upload(path, v.bytes, { contentType: v.mime, upsert: true });
    if (upErr) return { error: "Envoi du selfie impossible. Réessayez." };
    paths.push(path);
  }
  await logIdvAudit({
    verificationId: verifId,
    actorType: "user",
    actorId: user.id,
    action: "selfie_uploaded",
    metadata: { selfieAttempt, frames: paths.length },
  });

  // ── Analyse (géométrie + embeddings) puis JUGEMENT ici ────────────────────
  const analysis = await callAnalyzeSelfie({ paths });
  if (!analysis) {
    await applyStatus({ status: "pending_review", selfie_frames: paths });
    await logIdvAudit({
      verificationId: verifId,
      actorType: "system",
      action: "sent_to_review",
      reason: "pipeline_unavailable",
      metadata: { selfieAttempt },
    });
    revalidatePath("/driver/identite");
    return { ok: true, status: "pending_review" };
  }

  const evaluation = evaluateLiveness(
    challenges,
    analysis.frames.map((f) => f.face)
  );
  // Cohérence : le MÊME visage sur toutes les frames (anti-échange).
  let minCosine: number | null = null;
  const ref = analysis.frames[0]?.embedding;
  if (ref) {
    for (let i = 1; i < analysis.frames.length; i++) {
      const emb = analysis.frames[i]?.embedding;
      if (!emb) continue;
      const cos = embeddingCosine(ref, emb);
      minCosine = minCosine === null ? cos : Math.min(minCosine, cos);
    }
  }
  const consistencyOk =
    minCosine === null || minCosine >= FRAME_CONSISTENCY_MIN;
  const score =
    Math.round(evaluation.score * (consistencyOk ? 1 : 0.5) * 1000) / 1000;
  const { policy, livenessMin } = await loadModeParams(verif.mode as string);
  const passed = evaluation.passed && consistencyOk && score >= livenessMin;

  await table<PlainInsert>("idv_checks").insert({
    verification_id: verifId,
    attempt: selfieAttempt,
    check_key: "liveness_active",
    status: passed ? "passed" : "failed",
    score,
    details: {
      challenges,
      verdicts: evaluation.verdicts,
      minCosine,
      consistencyOk,
      livenessMin,
    },
  });
  await table<PlainInsert>("idv_checks").insert({
    verification_id: verifId,
    attempt: selfieAttempt,
    check_key: "liveness_passive",
    status: "skipped",
    score: null,
    details: { reason: "minifasnet_not_wired_yet" },
  });

  if (passed) {
    // Décision automatique (face match document ↔ selfie) = étape 7 : en
    // attendant, dossier complet → revue humaine.
    await applyStatus({
      selfie_path: paths[0],
      selfie_frames: paths,
      status: "pending_review",
    });
    await logIdvAudit({
      verificationId: verifId,
      actorType: "system",
      action: "selfie_processed",
      reason: "liveness_passed",
      metadata: { selfieAttempt, score, minCosine },
    });
    revalidatePath("/driver/identite");
    return { ok: true, status: "pending_review" };
  }

  // Incohérence de visage entre frames = signal de fraude → policy directe.
  // Sinon : coaching + reprise tant qu'il reste des tentatives, puis policy.
  const exhausted = selfieAttempt >= maxAttempts;
  if (!consistencyOk || exhausted) {
    const reason = !consistencyOk ? "liveness_inconsistent" : "liveness_low";
    if (policy.liveness_fail === "reject") {
      await applyStatus({
        selfie_frames: paths,
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
        metadata: { selfieAttempt, score, minCosine },
      });
      revalidatePath("/driver/identite");
      return { ok: true, status: "rejected" };
    }
    await applyStatus({ selfie_frames: paths, status: "pending_review" });
    await logIdvAudit({
      verificationId: verifId,
      actorType: "system",
      action: "sent_to_review",
      reason,
      metadata: { selfieAttempt, score, minCosine },
    });
    revalidatePath("/driver/identite");
    return { ok: true, status: "pending_review" };
  }

  await logIdvAudit({
    verificationId: verifId,
    actorType: "system",
    action: "selfie_processed",
    reason: "liveness_retryable_failure",
    metadata: {
      selfieAttempt,
      score,
      verdicts: evaluation.verdicts.filter((v) => !v.passed),
    },
  });
  revalidatePath("/driver/identite");
  return {
    error: livenessCoaching(evaluation.verdicts.map((v) => v.reason)),
    status: keepStatus,
  };
}
