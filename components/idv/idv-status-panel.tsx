"use client";

// =============================================================================
// IDV — panneau de STATUT du dossier (vue « propriétaire »). Un seul message
// clair par état + le tracker des 3 étapes. Aucun statut inventé : tout vient
// du backend (règle produit).
// =============================================================================

import {
  BadgeCheck,
  CircleCheck,
  Clock,
  Loader2,
  RefreshCcw,
  XCircle,
} from "lucide-react";
import { useLocale } from "next-intl";
import { idvStatusLabel, type IdvStatus } from "@/lib/idv/types";

const TRACKER_STEPS = [
  ["Document", "الوثيقة"],
  ["Selfie", "سيلفي"],
  ["Décision", "القرار"],
] as const;

/** Étape atteinte (0-2) selon le statut. */
function reachedStep(status: IdvStatus): number {
  if (
    status === "approved" ||
    status === "rejected" ||
    status === "pending_review"
  )
    return 2;
  if (
    status === "doc_validated" ||
    status === "selfie_processing" ||
    status === "resubmit_selfie"
  )
    return 1;
  return 0;
}

export function IdvStatusPanel({
  status,
  onRetryDocument,
  onStartSelfie,
  selfiePending = false,
  selfieError = null,
}: {
  status: IdvStatus;
  /** Présent quand l'utilisateur peut reprendre la photo du document. */
  onRetryDocument?: () => void;
  /** Présent quand l'étape selfie est accessible (doc validé / selfie redemandé). */
  onStartSelfie?: () => void;
  selfiePending?: boolean;
  selfieError?: string | null;
}) {
  const step = reachedStep(status);
  const locale = useLocale();
  const isAr = locale === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);

  const content: Record<
    string,
    { icon: React.ReactNode; tone: string; hint: string | null }
  > = {
    doc_validated: {
      icon: (
        <CircleCheck className="size-10" style={{ color: "var(--idv-ok)" }} />
      ),
      tone: idvStatusLabel("doc_validated", locale),
      hint: tr(
        "Étape suivante : un selfie rapide, avec quelques gestes simples.",
        "الخطوة التالية: سيلفي سريع مع بعض الحركات البسيطة."
      ),
    },
    doc_processing: {
      icon: (
        <Loader2
          className="size-10 animate-spin"
          style={{ color: "var(--idv-accent)" }}
        />
      ),
      tone: idvStatusLabel("doc_processing", locale),
      hint: tr("Quelques secondes…", "بضع ثوانٍ…"),
    },
    selfie_processing: {
      icon: (
        <Loader2
          className="size-10 animate-spin"
          style={{ color: "var(--idv-accent)" }}
        />
      ),
      tone: idvStatusLabel("selfie_processing", locale),
      hint: tr("Quelques secondes…", "بضع ثوانٍ…"),
    },
    pending_review: {
      icon: <Clock className="size-10" style={{ color: "var(--idv-warn)" }} />,
      tone: idvStatusLabel("pending_review", locale),
      hint: tr(
        "L'équipe Coligo examine votre dossier. Vous serez notifié du résultat.",
        "فريق كوليغو يدرس ملفك. سيتم إشعارك بالنتيجة."
      ),
    },
    approved: {
      icon: (
        <BadgeCheck className="size-10" style={{ color: "var(--idv-ok)" }} />
      ),
      tone: idvStatusLabel("approved", locale),
      hint: null,
    },
    rejected: {
      icon: <XCircle className="size-10" style={{ color: "var(--idv-bad)" }} />,
      tone: idvStatusLabel("rejected", locale),
      hint: tr(
        "Contactez le support si vous pensez qu'il s'agit d'une erreur.",
        "تواصل مع الدعم إذا كنت تعتقد أن الأمر خطأ."
      ),
    },
    resubmit_document: {
      icon: (
        <RefreshCcw className="size-10" style={{ color: "var(--idv-warn)" }} />
      ),
      tone: idvStatusLabel("resubmit_document", locale),
      hint: tr(
        "L'équipe Coligo a besoin d'une photo plus lisible de votre pièce.",
        "فريق كوليغو بحاجة إلى صورة أوضح لوثيقتك."
      ),
    },
    resubmit_selfie: {
      icon: (
        <RefreshCcw className="size-10" style={{ color: "var(--idv-warn)" }} />
      ),
      tone: idvStatusLabel("resubmit_selfie", locale),
      hint: tr(
        "L'équipe Coligo a besoin d'un nouveau selfie de vérification.",
        "فريق كوليغو بحاجة إلى سيلفي تحقّق جديد."
      ),
    },
  };

  const c = content[status] ?? {
    icon: <Clock className="size-10" style={{ color: "var(--idv-muted)" }} />,
    tone: idvStatusLabel(status, locale),
    hint: null,
  };

  return (
    <div className="space-y-5 pb-6">
      <div
        className="flex flex-col items-center gap-3 rounded-lg p-6 text-center"
        style={{
          background: "var(--idv-card)",
          border: "1px solid var(--idv-line)",
        }}
      >
        {c.icon}
        <p className="text-base font-bold">{c.tone}</p>
        {c.hint && (
          <p
            className="text-xs leading-relaxed"
            style={{ color: "var(--idv-muted)" }}
          >
            {c.hint}
          </p>
        )}
        {status === "resubmit_document" && onRetryDocument && (
          <button
            type="button"
            onClick={onRetryDocument}
            className="mt-1 rounded-full px-5 py-2.5 text-sm font-semibold text-white"
            style={{ background: "var(--idv-accent)" }}
          >
            {tr("Reprendre la photo", "إعادة التقاط الصورة")}
          </button>
        )}
        {(status === "doc_validated" || status === "resubmit_selfie") &&
          onStartSelfie && (
            <>
              {selfieError && (
                <p
                  className="w-full rounded-md px-3 py-2.5 text-sm"
                  style={{
                    background: "rgba(239,68,68,.12)",
                    color: "var(--idv-bad)",
                  }}
                >
                  {selfieError}
                </p>
              )}
              <button
                type="button"
                onClick={onStartSelfie}
                disabled={selfiePending}
                className="mt-1 rounded-full px-5 py-2.5 text-sm font-semibold text-white disabled:opacity-60"
                style={{ background: "var(--idv-accent)" }}
              >
                {selfiePending
                  ? tr("Préparation…", "جارٍ التحضير…")
                  : status === "resubmit_selfie"
                    ? tr("Refaire le selfie", "إعادة السيلفي")
                    : tr("Faire le selfie", "التقاط السيلفي")}
              </button>
            </>
          )}
      </div>

      {/* Tracker des 3 étapes. */}
      <div className="flex items-center px-2">
        {TRACKER_STEPS.map(([labelFr, labelAr], i) => {
          const label = isAr ? labelAr : labelFr;
          const done = i < step || status === "approved";
          const current = i === step && status !== "approved";
          return (
            <div
              key={labelFr}
              className="flex flex-1 items-center last:flex-none"
            >
              <div className="flex flex-col items-center gap-1">
                <span
                  className="text-caption flex size-7 items-center justify-center rounded-full font-bold"
                  style={{
                    background: done
                      ? "var(--idv-ok)"
                      : current
                        ? "var(--idv-accent)"
                        : "var(--idv-soft)",
                    color: done || current ? "#fff" : "var(--idv-muted)",
                  }}
                >
                  {done ? <CircleCheck className="size-4" /> : i + 1}
                </span>
                <span
                  className="text-micro font-medium"
                  style={{
                    color:
                      done || current ? "var(--idv-ink)" : "var(--idv-muted)",
                  }}
                >
                  {label}
                </span>
              </div>
              {i < TRACKER_STEPS.length - 1 && (
                <span
                  className="mx-1 mb-4 h-0.5 flex-1 rounded"
                  style={{
                    background: i < step ? "var(--idv-ok)" : "var(--idv-line)",
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
