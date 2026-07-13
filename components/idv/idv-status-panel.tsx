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
import { IDV_STATUS_LABELS_FR, type IdvStatus } from "@/lib/idv/types";

const TRACKER_STEPS = ["Document", "Selfie", "Décision"] as const;

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

  const content: Record<
    string,
    { icon: React.ReactNode; tone: string; hint: string | null }
  > = {
    doc_validated: {
      icon: (
        <CircleCheck
          className="size-10"
          style={{ color: "var(--d-mint, #10b981)" }}
        />
      ),
      tone: "Document validé",
      hint: "Étape suivante : un selfie rapide, avec quelques gestes simples.",
    },
    doc_processing: {
      icon: (
        <Loader2
          className="size-10 animate-spin"
          style={{ color: "var(--d-accent)" }}
        />
      ),
      tone: IDV_STATUS_LABELS_FR.doc_processing,
      hint: "Quelques secondes…",
    },
    selfie_processing: {
      icon: (
        <Loader2
          className="size-10 animate-spin"
          style={{ color: "var(--d-accent)" }}
        />
      ),
      tone: IDV_STATUS_LABELS_FR.selfie_processing,
      hint: "Quelques secondes…",
    },
    pending_review: {
      icon: (
        <Clock
          className="size-10"
          style={{ color: "var(--d-amber, #f59e0b)" }}
        />
      ),
      tone: "Vérification manuelle en cours",
      hint: "L'équipe Coligo examine votre dossier. Vous serez notifié du résultat.",
    },
    approved: {
      icon: (
        <BadgeCheck
          className="size-10"
          style={{ color: "var(--d-mint, #10b981)" }}
        />
      ),
      tone: "Identité vérifiée",
      hint: null,
    },
    rejected: {
      icon: (
        <XCircle
          className="size-10"
          style={{ color: "var(--d-coral, #ef4444)" }}
        />
      ),
      tone: "Vérification refusée",
      hint: "Contactez le support si vous pensez qu'il s'agit d'une erreur.",
    },
    resubmit_document: {
      icon: (
        <RefreshCcw
          className="size-10"
          style={{ color: "var(--d-amber, #f59e0b)" }}
        />
      ),
      tone: "Nouveau document demandé",
      hint: "L'équipe Coligo a besoin d'une photo plus lisible de votre pièce.",
    },
    resubmit_selfie: {
      icon: (
        <RefreshCcw
          className="size-10"
          style={{ color: "var(--d-amber, #f59e0b)" }}
        />
      ),
      tone: "Nouveau selfie demandé",
      hint: "L'équipe Coligo a besoin d'un nouveau selfie de vérification.",
    },
  };

  const c = content[status] ?? {
    icon: <Clock className="size-10" style={{ color: "var(--d-muted)" }} />,
    tone: IDV_STATUS_LABELS_FR[status] ?? status,
    hint: null,
  };

  return (
    <div className="space-y-5 pb-6">
      <div
        className="flex flex-col items-center gap-3 rounded-[16px] p-6 text-center"
        style={{
          background: "var(--d-card)",
          border: "1px solid var(--d-line)",
        }}
      >
        {c.icon}
        <p className="text-base font-bold">{c.tone}</p>
        {c.hint && (
          <p
            className="text-xs leading-relaxed"
            style={{ color: "var(--d-muted)" }}
          >
            {c.hint}
          </p>
        )}
        {status === "resubmit_document" && onRetryDocument && (
          <button
            type="button"
            onClick={onRetryDocument}
            className="mt-1 rounded-full px-5 py-2.5 text-sm font-semibold text-white"
            style={{ background: "var(--d-accent)" }}
          >
            Reprendre la photo
          </button>
        )}
        {(status === "doc_validated" || status === "resubmit_selfie") &&
          onStartSelfie && (
            <>
              {selfieError && (
                <p
                  className="w-full rounded-[12px] px-3 py-2.5 text-sm"
                  style={{
                    background: "rgba(239,68,68,.12)",
                    color: "var(--d-coral, #ef4444)",
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
                style={{ background: "var(--d-accent)" }}
              >
                {selfiePending
                  ? "Préparation…"
                  : status === "resubmit_selfie"
                    ? "Refaire le selfie"
                    : "Faire le selfie"}
              </button>
            </>
          )}
      </div>

      {/* Tracker des 3 étapes. */}
      <div className="flex items-center px-2">
        {TRACKER_STEPS.map((label, i) => {
          const done = i < step || status === "approved";
          const current = i === step && status !== "approved";
          return (
            <div
              key={label}
              className="flex flex-1 items-center last:flex-none"
            >
              <div className="flex flex-col items-center gap-1">
                <span
                  className="flex size-7 items-center justify-center rounded-full text-[11px] font-bold"
                  style={{
                    background: done
                      ? "var(--d-mint, #10b981)"
                      : current
                        ? "var(--d-accent)"
                        : "var(--d-soft)",
                    color: done || current ? "#fff" : "var(--d-muted)",
                  }}
                >
                  {done ? <CircleCheck className="size-4" /> : i + 1}
                </span>
                <span
                  className="text-[10px] font-medium"
                  style={{
                    color: done || current ? "var(--d-ink)" : "var(--d-muted)",
                  }}
                >
                  {label}
                </span>
              </div>
              {i < TRACKER_STEPS.length - 1 && (
                <span
                  className="mx-1 mb-4 h-0.5 flex-1 rounded"
                  style={{
                    background:
                      i < step ? "var(--d-mint, #10b981)" : "var(--d-line)",
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
