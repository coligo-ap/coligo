"use server";

import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
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
  DOC_QUALITY_REASONS_AR,
  DOC_QUALITY_REASONS_FR,
  type DocQuality,
} from "@/lib/idv/pipeline/quality";
import { logIdvAudit } from "@/lib/idv/audit";
import { openIdvManualFallback } from "@/lib/idv/fallback";
import { ANTISPOOF_LIVE_MIN } from "@/lib/idv/pipeline/antispoof";
import {
  FACE_QUALITY_REASONS_FR,
  REPLAY_HAMMING_MAX,
  RIVAL_FACE_MAX,
  type FaceQuality,
  type FaceQualityReason,
} from "@/lib/idv/pipeline/face-quality";
import { getIdvCompliance, type IdvCompliance } from "@/lib/idv/compliance";
import { IDV_ACTIVE_STATUSES, type IdvStatus } from "@/lib/idv/types";
import {
  decideIdv,
  IDV_DEFAULT_POLICY,
  type IdvCheckResult,
  type IdvThresholds,
} from "@/lib/idv/decision";
import {
  storeAndPushNotification,
  type NotifAudience,
} from "@/lib/notifications/notify";
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
  FaceMatchRequest,
  FaceMatchResponse,
} from "@/lib/idv/pipeline/analyze-contract";

// =============================================================================
// ACTIONS IDV — parcours de vérification d'identité, PARTAGÉES par les trois
// espaces (livreur, chauffeur, commerçant). Le client guide la prise de vue ;
// ICI on refait tous les contrôles qui font foi : magic bytes, qualité photo,
// analyse du document (MRZ + checksums + expiration), liveness à défis signés,
// face match, puis la décision à seuils (docs/IDV-KYC.md).
//
// Écritures via service_role (aucune policy RLS sur idv_*) → session vérifiée,
// PROFIL VALIDÉ (resolveProfile), périmètre user_id systématique.
// =============================================================================

const BUCKET = "idv-captures";
const MAX_DOC_BYTES = 8 * MB;

/** Messages utilisateur dans la langue du cookie NEXT_LOCALE (FR/AR). */
async function idvTr(fr: string, ar: string): Promise<string> {
  return (await getLocale()) === "ar" ? ar : fr;
}

/** `true` si la locale de la requête est l'arabe (messages composés). */
async function idvIsAr(): Promise<boolean> {
  return (await getLocale()) === "ar";
}

// ── Profils : route, audience de notification, table qui prouve l'identité ──
// Le profil vient du CLIENT (il choisit sa surface) mais n'est JAMAIS cru sur
// parole : `resolveProfile` vérifie que l'utilisateur possède réellement ce
// rôle (ligne dans drivers / chauffeurs / merchants). Un livreur ne peut donc
// pas ouvrir un dossier « commerçant », ni contourner la règle d'un profil.
const PROFILES = {
  driver: {
    route: "/driver/identite",
    audience: "driver" as const,
    table: "drivers",
  },
  chauffeur: {
    route: "/chauffeur/identite",
    audience: "chauffeur" as const,
    table: "chauffeurs",
  },
  merchant: {
    route: "/identite",
    audience: "merchant" as const,
    table: "merchants",
  },
} satisfies Record<
  string,
  { route: string; audience: NotifAudience; table: string }
>;

export type IdvProfileKey = keyof typeof PROFILES;

type OwnershipSelect = {
  select: (cols: string) => {
    eq: (
      c: string,
      v: string
    ) => { maybeSingle: () => Promise<{ data: Row | null }> };
  };
};

/**
 * Valide que l'utilisateur possède bien le profil demandé. null = profil
 * inconnu ou usurpé → l'appelant refuse l'action.
 */
async function resolveProfile(
  userId: string,
  requested: unknown
): Promise<IdvProfileKey | null> {
  const key = String(requested ?? "") as IdvProfileKey;
  if (!(key in PROFILES)) return null;
  const { data } = await table<OwnershipSelect>(PROFILES[key].table)
    .select("id")
    .eq("user_id", userId)
    .maybeSingle();
  return data ? key : null;
}

function revalidateIdv(profile: IdvProfileKey): void {
  revalidatePath(PROFILES[profile].route);
}

/** Résumé d'un contrôle, tel que le CLIENT a le droit de le voir : le
 *  résultat, jamais le score (les seuils restent invisibles — anti-gaming). */
export type IdvCheckSummary = {
  key: string;
  status: "passed" | "failed" | "skipped" | "error";
};

export type IdvSubmitState = {
  error?: string;
  ok?: boolean;
  status?: IdvStatus;
  /** Contrôles réellement exécutés — alimente l'écran d'analyse animé. */
  checks?: IdvCheckSummary[];
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
  thresholds: IdvThresholds;
  checks: Record<string, boolean>;
  livenessMin: number;
}> {
  const { data } = await table<PolicySelect>("idv_modes")
    .select(
      "policy, checks, liveness_min, face_match_approve, face_match_reject, doc_confidence_min"
    )
    .eq("key", mode)
    .maybeSingle();
  const thresholds: IdvThresholds = {
    face_match_approve: Number(data?.face_match_approve ?? 0.6),
    face_match_reject: Number(data?.face_match_reject ?? 0.35),
    liveness_min: Number(data?.liveness_min ?? 0.7),
    doc_confidence_min: Number(data?.doc_confidence_min ?? 0.6),
  };
  return {
    policy: { ...IDV_DEFAULT_POLICY, ...((data?.policy ?? {}) as object) },
    thresholds,
    checks: (data?.checks ?? {}) as Record<string, boolean>,
    livenessMin: thresholds.liveness_min,
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
const callFaceMatch = (payload: FaceMatchRequest) =>
  callIdvApi<FaceMatchResponse>("face-match", payload);

/** Annonce le résultat à l'utilisateur (cloche + push). Fire-and-forget. */
async function notifyIdvOutcome(
  userId: string,
  profile: IdvProfileKey,
  outcome: "approved" | "pending_review" | "rejected"
): Promise<void> {
  const copy = {
    approved: {
      title: "Identité vérifiée",
      body: "Votre identité a été confirmée. Merci !",
    },
    pending_review: {
      title: "Vérification en cours",
      body: "L'équipe Coligo examine votre dossier. Vous serez notifié du résultat.",
    },
    rejected: {
      title: "Vérification refusée",
      body: "Votre identité n'a pas pu être confirmée. Contactez le support.",
    },
  }[outcome];
  await storeAndPushNotification({
    userId,
    audience: PROFILES[profile].audience,
    kind: `idv_${outcome}`,
    title: copy.title,
    body: copy.body,
    route: PROFILES[profile].route,
  });
}

/** Message inline pour les échecs REPRENABLES (photo à refaire). */
function retryableMessage(
  checks: AnalyzedCheck[],
  mrzFormat: "td1" | "td3" | null,
  isAr: boolean
): string {
  const parts: string[] = [];
  for (const c of checks) {
    if (c.key === "mrz") {
      parts.push(
        isAr
          ? `منطقة MRZ غير مقروءة — أعد التقاط الصورة${
              mrzFormat === "td1" ? " للوجه الخلفي" : ""
            }، والوثيقة مبسوطة جيدًا`
          : `Zone MRZ illisible — reprenez la photo${
              mrzFormat === "td1" ? " du verso" : ""
            }, document bien à plat`
      );
    } else if (c.key === "doc_face") {
      parts.push(
        isAr
          ? "لم يُعثر على الصورة الشخصية — أعد التقاط الوجه الأمامي، واضحًا وبلا انعكاس"
          : "Portrait introuvable — reprenez le recto, net et sans reflet"
      );
    }
  }
  return (
    parts.join(" · ") ||
    (isAr
      ? "الوثيقة غير مقروءة — أعد التقاط الصور"
      : "Document illisible — reprenez les photos")
  );
}

function qualityMessage(
  front: DocQuality,
  back: DocQuality | null,
  isAr: boolean
): string {
  const reasons = isAr ? DOC_QUALITY_REASONS_AR : DOC_QUALITY_REASONS_FR;
  const parts: string[] = [];
  if (front.verdict === "failed") {
    parts.push(
      (back ? (isAr ? "الوجه الأمامي: " : "Recto : ") : "") +
        reasons[front.reasons[0]]
    );
  }
  if (back && back.verdict === "failed") {
    parts.push(
      (isAr ? "الوجه الخلفي: " : "Verso : ") + reasons[back.reasons[0]]
    );
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
  if (!user)
    return {
      error: await idvTr(
        "Session expirée — reconnectez-vous.",
        "انتهت الجلسة — سجّل الدخول من جديد."
      ),
    };

  const profile = await resolveProfile(user.id, formData.get("profile"));
  if (!profile)
    return { error: await idvTr("Profil invalide.", "ملف تعريف غير صالح.") };

  const gate = await getIdvGate(profile);
  if (!gate.enabled) {
    return {
      error: await idvTr(
        "La vérification d'identité n'est pas disponible.",
        "التحقّق من الهوية غير متاح."
      ),
    };
  }

  // ── Identité DÉJÀ confirmée : jamais de nouveau dossier ───────────────────
  // Sans cette garde, un compte approuvé qui atterrit sur /identite (lien
  // périmé, notification ancienne, onglet rouvert) n'a AUCUN dossier « actif »
  // (getMyIdvVerification ne voit que les statuts vivants) → l'écran repart de
  // zéro, et soumettre créerait une ligne neuve dont l'updated_at plus récent
  // ferait perdre le statut « approved » à getMyLatestIdvVerification (utilisé
  // par le gate d'accès à l'espace). Un dossier approuvé ne se rouvre jamais.
  const compliance = await getIdvCompliance(profile);
  if (compliance.verified) {
    return { error: "Votre identité est déjà vérifiée." };
  }

  // ── Type de document + mode (toujours revalidés serveur) ─────────────────
  const docTypes = await getIdvDocumentTypes();
  const docType = docTypes.find(
    (d) => d.key === String(formData.get("document_type") ?? "")
  );
  if (!docType)
    return {
      error: await idvTr("Type de document invalide.", "نوع وثيقة غير صالح."),
    };

  // TD2 (2×36) : format prévu par le registre mais non implémenté par le
  // parseur (aucun document algérien) → traité comme « sans MRZ ».
  const mrzFormat = docType.mrz_format === "td2" ? null : docType.mrz_format;

  const enabledModes = await getIdvModes();
  const candidates = gate.allowedModes.filter((m) =>
    enabledModes.some((e) => e.key === m)
  );
  if (candidates.length === 0) {
    return {
      error: await idvTr(
        "Aucun mode de vérification disponible.",
        "لا يوجد أي وضع تحقّق متاح."
      ),
    };
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
    .eq("profile", profile)
    .in("status", IDV_ACTIVE_STATUSES)
    .maybeSingle();

  if (
    existing &&
    existing.status !== "draft" &&
    existing.status !== "resubmit_document"
  ) {
    return {
      error: await idvTr(
        "Un dossier est déjà en cours pour ce compte.",
        "يوجد ملف قيد المعالجة بالفعل لهذا الحساب."
      ),
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
        profile,
        mode,
        document_type: docType.key,
      })
      .select("id, attempt")
      .single();
    if (insErr || !created) {
      return {
        error: await idvTr(
          "Impossible d'ouvrir le dossier. Réessayez.",
          "تعذّر فتح الملف. أعد المحاولة."
        ),
      };
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
    revalidateIdv(profile);
    return { ok: true, status: "pending_review" };
  }

  // ── Upload bucket privé (chemins générés, extension vérifiée) ────────────
  const admin = createAdminClient();
  const base = `${user.id}/${verifId}/${attempt}`;
  const frontPath = `${base}-front.${front.ext}`;
  const { error: upFrontErr } = await admin.storage
    .from(BUCKET)
    .upload(frontPath, front.bytes, { contentType: front.mime, upsert: true });
  if (upFrontErr)
    return {
      error: await idvTr(
        "Envoi du recto impossible. Réessayez.",
        "تعذّر إرسال الوجه الأمامي. أعد المحاولة."
      ),
    };
  let backPath: string | null = null;
  if (back) {
    backPath = `${base}-back.${back.ext}`;
    const { error: upBackErr } = await admin.storage
      .from(BUCKET)
      .upload(backPath, back.bytes, { contentType: back.mime, upsert: true });
    if (upBackErr)
      return {
        error: await idvTr(
          "Envoi du verso impossible. Réessayez.",
          "تعذّر إرسال الوجه الخلفي. أعد المحاولة."
        ),
      };
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
    revalidateIdv(profile);
    return {
      error: qualityMessage(frontQuality, backQuality, await idvIsAr()),
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
    revalidateIdv(profile);
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

  // Résumé client (jamais les scores) : qualité + contrôles du pipeline.
  const summary: IdvCheckSummary[] = [
    { key: "doc_quality", status: "passed" },
    ...analysis.checks.map((c) => ({
      key: c.key,
      status: c.status as IdvCheckSummary["status"],
    })),
  ];

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
      revalidateIdv(profile);
      return { ok: true, status: "rejected", checks: summary };
    }
    await applyUpdate({ status: "pending_review" });
    await logIdvAudit({
      verificationId: verifId,
      actorType: "system",
      action: "sent_to_review",
      reason,
      metadata: { attempt, checks: hardFailures.map((c) => c.key) },
    });
    revalidateIdv(profile);
    return { ok: true, status: "pending_review", checks: summary };
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
    revalidateIdv(profile);
    return { ok: true, status: "pending_review", checks: summary };
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
    revalidateIdv(profile);
    return {
      error: retryableMessage(retryables, mrzFormat, await idvIsAr()),
      status: keepStatus,
      checks: summary,
    };
  }

  // 4) Tout est bon → « Document validé ».
  const updated = await applyUpdate({ status: "doc_validated" });
  if (!updated)
    return {
      error: await idvTr(
        "Enregistrement du dossier impossible. Réessayez.",
        "تعذّر حفظ الملف. أعد المحاولة."
      ),
    };
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
  revalidateIdv(profile);
  return { ok: true, status: "doc_validated", checks: summary };
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
export async function startIdvSelfie(
  requestedProfile: string
): Promise<IdvSelfieSession> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return {
      error: await idvTr(
        "Session expirée — reconnectez-vous.",
        "انتهت الجلسة — سجّل الدخول من جديد."
      ),
    };
  const profile = await resolveProfile(user.id, requestedProfile);
  if (!profile)
    return { error: await idvTr("Profil invalide.", "ملف تعريف غير صالح.") };
  const gate = await getIdvGate(profile);
  if (!gate.enabled)
    return {
      error: await idvTr("Vérification indisponible.", "التحقّق غير متاح."),
    };
  const secret = process.env.INTERNAL_IDV_SECRET;
  if (!secret)
    return {
      error: await idvTr("Vérification indisponible.", "التحقّق غير متاح."),
    };

  const { data: verif } = await table<ActiveSelect>("idv_verifications")
    .select("id, status")
    .eq("user_id", user.id)
    .eq("profile", profile)
    .in("status", IDV_ACTIVE_STATUSES)
    .maybeSingle();
  if (
    !verif ||
    (verif.status !== "doc_validated" && verif.status !== "resubmit_selfie")
  ) {
    return {
      error: await idvTr(
        "Validez d'abord votre document.",
        "تحقّق من وثيقتك أولًا."
      ),
    };
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
function livenessCoaching(reasons: (string | null)[], isAr: boolean): string {
  const map: Record<string, string> = isAr
    ? {
        no_face: "لم يُكتشف وجه — قف أمام الكاميرا في إضاءة جيدة",
        face_off_center: "ضع وجهك داخل الإطار البيضاوي",
        face_too_small: "قرّب الهاتف من وجهك",
        head_turn_not_detected: "أدر رأسك أكثر عند الطلب",
        not_closer: "قرّب الهاتف أكثر عندما يُطلب منك",
        not_farther: "أبعد الهاتف أكثر عندما يُطلب منك",
        eye_distance_collapsed: "أبقِ الهاتف مواجهًا لك تمامًا",
        reference_not_frontal: "انظر إلى العدسة مباشرة في الخطوة الأولى",
        no_reference: "أعد السيلفي من البداية",
      }
    : {
        no_face:
          "Visage non détecté — placez-vous face caméra, en pleine lumière",
        face_off_center: "Placez votre visage dans l'ovale",
        face_too_small: "Rapprochez le téléphone de votre visage",
        head_turn_not_detected: "Tournez davantage la tête au moment demandé",
        not_closer: "Rapprochez davantage le téléphone quand c'est demandé",
        not_farther: "Éloignez davantage le téléphone quand c'est demandé",
        eye_distance_collapsed: "Gardez le téléphone bien face à vous",
        reference_not_frontal: "Regardez bien l'objectif au premier temps",
        no_reference: "Recommencez le selfie depuis le début",
      };
  for (const r of reasons) if (r && map[r]) return map[r];
  return isAr
    ? "سيلفي غير مطابق — أعد المحاولة متبعًا التعليمات"
    : "Selfie non conforme — recommencez en suivant les consignes";
}

/** Coaching pour une capture INEXPLOITABLE (flou, trop petit, contre-jour). */
function faceQualityCoaching(
  reasons: readonly FaceQualityReason[],
  isAr: boolean
): string {
  const ar: Record<FaceQualityReason, string> = {
    face_too_small: "قرّب الهاتف: وجهك صغير جدًا",
    blurry: "الصورة مشوّشة — لا تتحرّك وأعد السيلفي",
    too_dark: "الإضاءة ضعيفة — قف مقابل مصدر ضوء",
    too_bright: "الإضاءة قوية جدًا — تجنّب الضوء المباشر خلفك",
    not_frontal: "انظر إلى العدسة مباشرة",
  };
  const first = reasons[0];
  if (!first) {
    return isAr
      ? "صورة غير واضحة — أعد السيلفي"
      : "Selfie inexploitable — refaites la photo";
  }
  return isAr ? ar[first] : FACE_QUALITY_REASONS_FR[first];
}

export async function submitIdvSelfie(
  _prev: IdvSubmitState,
  formData: FormData
): Promise<IdvSubmitState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return {
      error: await idvTr(
        "Session expirée — reconnectez-vous.",
        "انتهت الجلسة — سجّل الدخول من جديد."
      ),
    };
  const profile = await resolveProfile(user.id, formData.get("profile"));
  if (!profile)
    return { error: await idvTr("Profil invalide.", "ملف تعريف غير صالح.") };
  const gate = await getIdvGate(profile);
  if (!gate.enabled) {
    return {
      error: await idvTr(
        "La vérification d'identité n'est pas disponible.",
        "التحقّق من الهوية غير متاح."
      ),
    };
  }
  const secret = process.env.INTERNAL_IDV_SECRET;
  if (!secret)
    return {
      error: await idvTr("Vérification indisponible.", "التحقّق غير متاح."),
    };

  const { data: verif } = await table<ActiveSelect>("idv_verifications")
    .select("id, status, mode")
    .eq("user_id", user.id)
    .eq("profile", profile)
    .in("status", IDV_ACTIVE_STATUSES)
    .maybeSingle();
  if (
    !verif ||
    (verif.status !== "doc_validated" && verif.status !== "resubmit_selfie")
  ) {
    return {
      error: await idvTr(
        "Dossier non prêt pour le selfie.",
        "الملف غير جاهز للسيلفي."
      ),
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
    return {
      error: await idvTr(
        "Session de vérification expirée — relancez le selfie.",
        "انتهت جلسة التحقّق — أعد تشغيل السيلفي."
      ),
    };
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
    revalidateIdv(profile);
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
    if (upErr)
      return {
        error: await idvTr(
          "Envoi du selfie impossible. Réessayez.",
          "تعذّر إرسال السيلفي. أعد المحاولة."
        ),
      };
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
    revalidateIdv(profile);
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
  const {
    policy,
    thresholds,
    checks: modeChecks,
    livenessMin,
  } = await loadModeParams(verif.mode as string);
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
  // ── Anti-spoof PASSIF (MiniFASNetV2) : photo imprimée / écran / rejeu ─────
  // Score par frame → on retient le MINIMUM (une seule frame trahie suffit).
  // Le modèle n'est PAS encore calibré sur des captures d'appareils réels :
  // sous le seuil, on n'auto-refuse jamais — le dossier part en revue humaine
  // (policy `check_failed` du mode, « revue » par défaut).
  const passiveScores = analysis.frames
    .map((f) => f.passiveLiveness)
    .filter((v): v is number => typeof v === "number");
  const passiveMin = passiveScores.length ? Math.min(...passiveScores) : null;
  const passiveOk = passiveMin === null || passiveMin >= ANTISPOOF_LIVE_MIN;
  await table<PlainInsert>("idv_checks").insert({
    verification_id: verifId,
    attempt: selfieAttempt,
    check_key: "liveness_passive",
    status: passiveMin === null ? "skipped" : passiveOk ? "passed" : "failed",
    score: passiveMin,
    details:
      passiveMin === null
        ? { reason: "model_unavailable" }
        : {
            per_frame: analysis.frames.map((f) => f.passiveLiveness),
            threshold: ANTISPOOF_LIVE_MIN,
            model: "minifasnet_v2",
          },
  });

  // ── QUALITÉ BIOMÉTRIQUE du selfie (le contrôle qui manquait) ──────────────
  // Le pipeline savait dire « il y a un visage » ; il ne savait pas dire « ce
  // visage est exploitable ». Or juger une identité sur une capture floue,
  // minuscule ou à contre-jour, c'est tirer au sort : le modèle rendra un score,
  // mais ce score ne veut plus rien dire — et les deux issues sont fausses
  // (refuser un livreur honnête, ou laisser passer un imposteur que le bruit a
  // rapproché de sa cible). La bonne réponse n'est ni oui ni non : c'est
  // « refaites la photo ».
  // On juge sur la MEILLEURE frame : l'utilisateur bouge pendant les défis, le
  // condamner sur sa plus mauvaise prise serait injuste.
  const qualities = analysis.frames
    .map((f) => f.quality)
    .filter((q): q is FaceQuality => q != null);
  const bestQuality = qualities.length
    ? qualities.reduce((a, b) => (b.score > a.score ? b : a))
    : null;
  const qualityOk = bestQuality ? bestQuality.verdict === "passed" : true;
  await table<PlainInsert>("idv_checks").insert({
    verification_id: verifId,
    attempt: selfieAttempt,
    check_key: "selfie_quality",
    status: !bestQuality ? "skipped" : qualityOk ? "passed" : "failed",
    score: bestQuality?.score ?? null,
    details: bestQuality
      ? {
          best: bestQuality,
          per_frame: analysis.frames.map((f) => f.quality?.score ?? null),
        }
      : { reason: "no_face_detected" },
  });

  // ── AMBIGUÏTÉ : qui d'autre est dans le cadre ? ───────────────────────────
  // Un second visage aussi grand que le principal, et « le plus grand visage »
  // cesse d'être une réponse : c'est un pari sur l'identité de quelqu'un. Ça
  // peut être innocent (un collègue derrière l'épaule) comme frauduleux (le
  // portrait d'un tiers brandi devant l'objectif) — ce n'est donc pas à la
  // machine de trancher : revue humaine, jamais de refus automatique.
  const rival = analysis.frames.reduce((m, f) => Math.max(m, f.rival ?? 0), 0);
  const ambiguous = rival >= RIVAL_FACE_MAX;
  await table<PlainInsert>("idv_checks").insert({
    verification_id: verifId,
    attempt: selfieAttempt,
    check_key: "face_ambiguity",
    status: ambiguous ? "failed" : "passed",
    score: Math.round((1 - Math.min(1, rival)) * 1000) / 1000,
    details: {
      rival,
      threshold: RIVAL_FACE_MAX,
      per_frame: analysis.frames.map((f) => f.rival ?? 0),
    },
  });

  // Résumé client des contrôles du selfie (résultats, jamais les scores).
  const selfieSummary: IdvCheckSummary[] = [
    {
      key: "selfie_quality",
      status: !bestQuality ? "skipped" : qualityOk ? "passed" : "failed",
    },
    { key: "liveness_active", status: passed ? "passed" : "failed" },
    {
      key: "liveness_passive",
      status: passiveMin === null ? "skipped" : passiveOk ? "passed" : "failed",
    },
    { key: "face_ambiguity", status: ambiguous ? "failed" : "passed" },
  ];

  // Deux visages dans le cadre : on ne devine pas, on fait relire.
  if (ambiguous) {
    await applyStatus({
      selfie_path: paths[0],
      selfie_frames: paths,
      status: "pending_review",
    });
    await logIdvAudit({
      verificationId: verifId,
      actorType: "system",
      action: "sent_to_review",
      reason: "face_ambiguity",
      metadata: { selfieAttempt, rival, threshold: RIVAL_FACE_MAX },
    });
    await notifyIdvOutcome(user.id, profile, "pending_review");
    revalidateIdv(profile);
    return { ok: true, status: "pending_review", checks: selfieSummary };
  }

  // Capture inexploitable : on REDEMANDE une photo — on ne juge pas sur du flou.
  // À court de tentatives, la revue humaine prend le relais (jamais un refus :
  // une mauvaise photo n'est pas une fraude).
  if (!qualityOk && bestQuality) {
    if (selfieAttempt >= maxAttempts) {
      await applyStatus({
        selfie_path: paths[0],
        selfie_frames: paths,
        status: "pending_review",
      });
      await logIdvAudit({
        verificationId: verifId,
        actorType: "system",
        action: "sent_to_review",
        reason: "selfie_quality_low",
        metadata: { selfieAttempt, quality: bestQuality },
      });
      await notifyIdvOutcome(user.id, profile, "pending_review");
      revalidateIdv(profile);
      return { ok: true, status: "pending_review", checks: selfieSummary };
    }
    await logIdvAudit({
      verificationId: verifId,
      actorType: "system",
      action: "selfie_processed",
      reason: "selfie_quality_retryable",
      metadata: { selfieAttempt, quality: bestQuality },
    });
    revalidateIdv(profile);
    return {
      error: faceQualityCoaching(bestQuality.reasons, await idvIsAr()),
      status: keepStatus,
      checks: selfieSummary,
    };
  }

  // Suspicion d'attaque passive (photo/écran) : le dossier ne peut PAS être
  // approuvé automatiquement — il part en revue humaine avec le score.
  if (passed && !passiveOk) {
    await applyStatus({ selfie_path: paths[0], selfie_frames: paths });
    await logIdvAudit({
      verificationId: verifId,
      actorType: "system",
      action: "sent_to_review",
      reason: "passive_spoof_suspected",
      metadata: { selfieAttempt, passiveMin, threshold: ANTISPOOF_LIVE_MIN },
    });
    await table<UpdateById>("idv_verifications")
      .update({ status: "pending_review" })
      .eq("id", verifId);
    await notifyIdvOutcome(user.id, profile, "pending_review");
    revalidateIdv(profile);
    return { ok: true, status: "pending_review", checks: selfieSummary };
  }

  if (passed) {
    await applyStatus({
      selfie_path: paths[0],
      selfie_frames: paths,
      status: "selfie_processing",
    });
    await logIdvAudit({
      verificationId: verifId,
      actorType: "system",
      action: "selfie_processed",
      reason: "liveness_passed",
      metadata: { selfieAttempt, score, minCosine },
    });
    return finalizeIdvDecision({
      summary: selfieSummary,
      userId: user.id,
      profile,
      verifId,
      attempt: selfieAttempt,
      thresholds,
      policy,
      modeChecks,
      livenessScore: score,
      selfiePath: paths[0],
      framePaths: paths,
    });
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
      revalidateIdv(profile);
      return { ok: true, status: "rejected", checks: selfieSummary };
    }
    await applyStatus({ selfie_frames: paths, status: "pending_review" });
    await logIdvAudit({
      verificationId: verifId,
      actorType: "system",
      action: "sent_to_review",
      reason,
      metadata: { selfieAttempt, score, minCosine },
    });
    revalidateIdv(profile);
    return { ok: true, status: "pending_review", checks: selfieSummary };
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
  revalidateIdv(profile);
  return {
    error: livenessCoaching(
      evaluation.verdicts.map((v) => v.reason),
      await idvIsAr()
    ),
    status: keepStatus,
    checks: selfieSummary,
  };
}

// ═════════════════════════════════════════════════════════════════════════════
// DÉCISION AUTOMATIQUE (étape 7) — face match puis moteur à seuils.
// Le dossier est complet : document validé + présence réelle établie. On
// compare le PORTRAIT DU DOCUMENT au SELFIE, puis `decideIdv` (pur, testé)
// tranche selon les seuils du mode : approbation auto / revue humaine /
// refus auto. La zone intermédiaire va TOUJOURS en revue humaine.
// ═════════════════════════════════════════════════════════════════════════════

type VerifSelect = {
  select: (cols: string) => {
    eq: (
      c: string,
      v: string
    ) => { maybeSingle: () => Promise<{ data: Row | null }> };
  };
};

/** Score du dernier check `doc_quality` du dossier (confiance document). */
type ChecksSelect = {
  select: (cols: string) => {
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
        ) => {
          limit: (n: number) => Promise<{ data: Row[] | null }>;
        };
      };
    };
  };
};

async function finalizeIdvDecision(input: {
  /** Contrôles déjà exécutés (liveness) — complétés ici par face_match. */
  summary: IdvCheckSummary[];
  userId: string;
  profile: IdvProfileKey;
  verifId: string;
  attempt: number;
  thresholds: IdvThresholds;
  policy: Record<string, "reject" | "review">;
  modeChecks: Record<string, boolean>;
  livenessScore: number;
  selfiePath: string;
  /** Toutes les vues capturées (défis compris) : la comparaison retient la
   *  MEILLEURE. Une frame floue ne doit pas condamner quelqu'un. */
  framePaths?: string[];
}): Promise<IdvSubmitState> {
  const {
    summary,
    userId,
    profile,
    verifId,
    attempt,
    thresholds,
    policy,
    modeChecks,
    livenessScore,
    selfiePath,
    framePaths,
  } = input;

  /** Statut du garde anti-rejeu, connu seulement après le face match. */
  let replayStatus: IdvCheckSummary["status"] = "skipped";

  /** Résumé enrichi du face match (résultat seul, jamais le score). */
  const withFace = (status: IdvCheckSummary["status"]): IdvCheckSummary[] => [
    ...summary,
    { key: "face_match", status },
    { key: "face_replay", status: replayStatus },
  ];

  const toReview = async (
    reason: string,
    metadata: Record<string, unknown>,
    /** Le rejeu est le seul cas où le face match RÉUSSIT et où l'on refuse
     *  quand même de conclure : le résumé client doit le dire honnêtement. */
    faceStatus: IdvCheckSummary["status"] = reason === "face_not_comparable"
      ? "error"
      : "failed"
  ) => {
    await table<UpdateById>("idv_verifications")
      .update({ status: "pending_review" })
      .eq("id", verifId);
    await logIdvAudit({
      verificationId: verifId,
      actorType: "system",
      action: "sent_to_review",
      reason,
      metadata,
    });
    await notifyIdvOutcome(userId, profile, "pending_review");
    revalidateIdv(profile);
    return {
      ok: true,
      status: "pending_review" as IdvStatus,
      checks: withFace(faceStatus),
    };
  };

  const { data: verif } = await table<VerifSelect>("idv_verifications")
    .select("doc_front_path, document_expires_at")
    .eq("id", verifId)
    .maybeSingle();
  const docPath = verif?.doc_front_path as string | undefined;
  if (!docPath) return toReview("missing_document_capture", { attempt });

  // ── Face match : portrait du document ↔ selfie ────────────────────────────
  const match = await callFaceMatch({ docPath, selfiePath, framePaths });
  if (!match) {
    await table<PlainInsert>("idv_checks").insert({
      verification_id: verifId,
      attempt,
      check_key: "face_match",
      status: "error",
      score: null,
      details: { reason: "pipeline_unavailable" },
    });
    return toReview("pipeline_unavailable", { attempt });
  }

  const matchUsable = match.docFaceFound && match.selfieFaceFound;
  await table<PlainInsert>("idv_checks").insert({
    verification_id: verifId,
    attempt,
    check_key: "face_match",
    status: matchUsable
      ? match.score >= thresholds.face_match_approve
        ? "passed"
        : "failed"
      : "error",
    score: matchUsable ? match.score : null,
    details: {
      cosine: match.cosine,
      docFaceFound: match.docFaceFound,
      selfieFaceFound: match.selfieFaceFound,
      framesCompared: match.framesCompared,
      viewCosines: match.viewCosines,
      docQuality: match.docQuality,
      selfieQuality: match.selfieQuality,
      replayDistance: match.replayDistance,
      thresholds,
    },
  });
  if (!matchUsable) {
    return toReview("face_not_comparable", {
      attempt,
      docFaceFound: match.docFaceFound,
      selfieFaceFound: match.selfieFaceFound,
    });
  }

  // ── « Ce selfie n'est-il pas simplement la photo du document ? » ──────────
  // Un cosinus parfait obtenu par copier-coller n'est pas une vérification : si
  // le visage du selfie est, au pixel près, le portrait de la carte, alors rien
  // n'a été prouvé — et c'est justement le cas qui produirait le MEILLEUR score.
  // Le signal est fort mais pas une preuve (revue humaine, jamais de refus auto).
  if (match.replaySuspected) {
    replayStatus = "failed";
    await table<PlainInsert>("idv_checks").insert({
      verification_id: verifId,
      attempt,
      check_key: "face_replay",
      status: "failed",
      score: 0,
      details: {
        replayDistance: match.replayDistance,
        threshold: REPLAY_HAMMING_MAX,
        cosine: match.cosine,
      },
    });
    return toReview(
      "face_replay_suspected",
      {
        attempt,
        replayDistance: match.replayDistance,
        cosine: match.cosine,
        face_match: match.score,
      },
      // Le visage CORRESPOND (et même trop bien) : dire « échec de comparaison »
      // serait mentir à l'utilisateur sur ce qu'on lui reproche.
      "passed"
    );
  }
  replayStatus = "passed";
  await table<PlainInsert>("idv_checks").insert({
    verification_id: verifId,
    attempt,
    check_key: "face_replay",
    status: "passed",
    score: 1,
    details: {
      replayDistance: match.replayDistance,
      threshold: REPLAY_HAMMING_MAX,
    },
  });

  // ── Confiance document (dernier doc_quality du dossier) ───────────────────
  const { data: qualityRows } = await table<ChecksSelect>("idv_checks")
    .select("score")
    .eq("verification_id", verifId)
    .eq("check_key", "doc_quality")
    .order("created_at", { ascending: false })
    .limit(1);
  const docConfidence =
    qualityRows?.[0]?.score != null ? Number(qualityRows[0].score) : null;

  // ── Moteur de décision (pur, testé) ───────────────────────────────────────
  const today = new Date().toISOString().slice(0, 10);
  const expiresAt = verif?.document_expires_at as string | null;
  const checkResults: IdvCheckResult[] = [
    { key: "face_match", status: "passed", score: match.score },
    { key: "liveness_active", status: "passed", score: livenessScore },
  ];
  const decision = decideIdv({
    thresholds,
    policy,
    scores: {
      face_match: match.score,
      liveness: livenessScore,
      doc_confidence: docConfidence,
    },
    checks: checkResults,
    documentExpired: Boolean(expiresAt && expiresAt < today),
    livenessRequired:
      modeChecks.liveness_active === true ||
      modeChecks.liveness_passive === true,
  });

  const metadata = {
    attempt,
    outcome: decision.outcome,
    reasons: decision.reasons,
    face_match: match.score,
    cosine: match.cosine,
    liveness: livenessScore,
    doc_confidence: docConfidence,
    thresholds,
  };

  if (decision.outcome === "approve") {
    await table<UpdateById>("idv_verifications")
      .update({
        status: "approved",
        decision: "auto_approved",
        decision_reason: decision.reasons.join(","),
        decided_at: new Date().toISOString(),
      })
      .eq("id", verifId);
    await logIdvAudit({
      verificationId: verifId,
      actorType: "system",
      action: "auto_approved",
      reason: decision.reasons.join(","),
      metadata,
    });
    await notifyIdvOutcome(userId, profile, "approved");
    revalidateIdv(profile);
    return { ok: true, status: "approved", checks: withFace("passed") };
  }

  if (decision.outcome === "reject") {
    await table<UpdateById>("idv_verifications")
      .update({
        status: "rejected",
        decision: "auto_rejected",
        decision_reason: decision.reasons.join(","),
        decided_at: new Date().toISOString(),
      })
      .eq("id", verifId);
    await logIdvAudit({
      verificationId: verifId,
      actorType: "system",
      action: "auto_rejected",
      reason: decision.reasons.join(","),
      metadata,
    });
    await notifyIdvOutcome(userId, profile, "rejected");
    revalidateIdv(profile);
    return { ok: true, status: "rejected", checks: withFace("failed") };
  }

  return toReview(decision.reasons.join(","), metadata);
}

/**
 * État de conformité IDV pour un composant CLIENT (compte chauffeur, qui vit
 * côté client par choix de perf). Lecture seule, profil validé, aucune donnée
 * sensible (ni scores, ni extractions).
 */
export async function fetchIdvCompliance(
  requestedProfile: string
): Promise<IdvCompliance | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;
  const profile = await resolveProfile(user.id, requestedProfile);
  if (!profile) return null;
  return getIdvCompliance(profile);
}

/**
 * REPLI MANUEL après un refus automatique (mig 0371).
 *
 * La machine se trompe : un document abîmé, une photo prise de nuit, un visage
 * qui a changé. Un refus automatique ne doit donc jamais être une impasse.
 * L'utilisateur refusé demande ici l'examen par l'équipe Coligo : son dossier
 * REVIENT dans la file de revue humaine, avec les captures de sa tentative, et
 * l'équipe tranche sur pièces.
 *
 * Ce que le serveur vérifie, et ne délègue jamais au client :
 *   • le profil appartient bien à l'utilisateur ;
 *   • le dernier dossier est bien REFUSÉ (on ne « repasse » pas en manuel un
 *     dossier approuvé, ni un dossier déjà en cours d'examen) ;
 *   • la décision précédente est effacée (un dossier rouvert n'est plus tranché),
 *     et la trace de la bascule reste au journal d'audit.
 */
export async function requestIdvManualReview(
  requestedProfile: string
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    return {
      ok: false,
      error: await idvTr("Session expirée.", "انتهت الجلسة."),
    };

  const profile = await resolveProfile(user.id, requestedProfile);
  if (!profile)
    return {
      ok: false,
      error: await idvTr("Profil inconnu.", "ملف تعريف مجهول."),
    };

  const res = await openIdvManualFallback(user.id, profile);
  if (!res.ok) return res;
  revalidateIdv(profile);
  return { ok: true };
}
