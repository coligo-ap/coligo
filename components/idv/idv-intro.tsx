"use client";

// =============================================================================
// IDV — écran d'entrée : il annonce UNIQUEMENT l'action qui vient (le scan du
// document) et propose le choix de la pièce. Les explications du selfie et de
// la vérification arrivent PLUS TARD, juste avant leur propre étape (cf.
// components/idv/idv-action-intro.tsx) — jamais les trois d'un coup : chaque
// consigne tombe au moment où elle sert.
// =============================================================================

import { useState } from "react";
import { useLocale } from "next-intl";
import { BookUser, Car, IdCard, Lock } from "lucide-react";
import { IdvActionIntro } from "./idv-action-intro";
import { IllusDocScan } from "./idv-illustrations";
import type { IdvDocumentType, IdvModePublic } from "@/lib/idv/types";

const DOC_ICONS: Record<string, typeof IdCard> = {
  dz_passport: BookUser,
  dz_cni: IdCard,
  dz_permis: Car,
};

export function IdvIntro({
  docTypes,
  modes,
  canChooseMode,
  defaultMode,
  onStart,
}: {
  docTypes: IdvDocumentType[];
  /** Modes proposables (déjà croisés autorisés ∩ actifs). */
  modes: IdvModePublic[];
  canChooseMode: boolean;
  defaultMode: string;
  onStart: (docTypeKey: string, modeKey: string) => void;
}) {
  const [docKey, setDocKey] = useState(docTypes[0]?.key ?? "");
  const [modeKey, setModeKey] = useState(
    modes.some((m) => m.key === defaultMode)
      ? defaultMode
      : (modes[0]?.key ?? "")
  );
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);

  return (
    <IdvActionIntro
      illustration={<IllusDocScan size={112} />}
      eyebrow={tr("Étape 1 sur 3", "الخطوة 1 من 3")}
      title={tr("Scannez votre pièce", "امسح وثيقتك")}
      hint={tr(
        "Le cadrage est guidé et la photo se prend toute seule.",
        "التأطير موجَّه والصورة تُلتقط تلقائيًا."
      )}
      cta={tr("Commencer", "ابدأ")}
      onStart={() => docKey && onStart(docKey, modeKey)}
    >
      <div className="space-y-4">
        <div className="space-y-2">
          <p className="text-sm font-semibold">
            {tr("Votre document", "وثيقتك")}
          </p>
          {docTypes.map((doc) => {
            const Icon = DOC_ICONS[doc.key] ?? IdCard;
            const active = docKey === doc.key;
            return (
              <button
                key={doc.key}
                type="button"
                onClick={() => setDocKey(doc.key)}
                className="rounded-card-lg flex w-full items-center gap-3 border p-3 text-start transition-colors"
                style={{
                  background: active ? "var(--idv-tint)" : "var(--idv-card)",
                  borderColor: active ? "var(--idv-accent)" : "var(--idv-line)",
                  boxShadow: active
                    ? "0 0 0 1px var(--idv-accent) inset"
                    : undefined,
                }}
              >
                <Icon
                  className="size-5 shrink-0"
                  style={{
                    color: active ? "var(--idv-accent)" : "var(--idv-muted)",
                  }}
                />
                <span className="flex-1 text-sm font-medium">
                  {(isAr && doc.label_ar) || doc.label_fr}
                </span>
                <span
                  className="size-4 rounded-full border-2"
                  style={{
                    borderColor: active
                      ? "var(--idv-accent)"
                      : "var(--idv-line)",
                    background: active ? "var(--idv-accent)" : "transparent",
                  }}
                />
              </button>
            );
          })}
        </div>

        {canChooseMode && modes.length > 1 && (
          <div className="space-y-2">
            <p className="text-sm font-semibold">
              {tr("Niveau de vérification", "مستوى التحقّق")}
            </p>
            <div className="grid grid-cols-2 gap-2">
              {modes.map((m) => {
                const active = modeKey === m.key;
                return (
                  <button
                    key={m.key}
                    type="button"
                    onClick={() => setModeKey(m.key)}
                    className="rounded-card-lg border p-3 text-start"
                    style={{
                      background: active
                        ? "var(--idv-tint)"
                        : "var(--idv-card)",
                      borderColor: active
                        ? "var(--idv-accent)"
                        : "var(--idv-line)",
                    }}
                  >
                    <p className="text-sm font-semibold">
                      {(isAr && m.label_ar) || m.label_fr}
                    </p>
                  </button>
                );
              })}
            </div>
          </div>
        )}

        <p
          className="text-caption flex items-center justify-center gap-1.5"
          style={{ color: "var(--idv-muted)" }}
        >
          <Lock className="size-3.5" />
          {tr(
            "Données chiffrées, visibles uniquement par l'équipe Coligo",
            "بيانات مشفّرة، لا يطّلع عليها إلا فريق كوليغو"
          )}
        </p>
      </div>
    </IdvActionIntro>
  );
}
