"use client";

// =============================================================================
// IDV — écran d'INTRO du parcours : les 3 étapes expliquées avec illustrations
// animées, choix du document, choix du mode (si autorisé). Textes courts
// style Bolt : l'utilisateur comprend en un coup d'œil ce qu'on va lui
// demander et pourquoi.
// =============================================================================

import { useState } from "react";
import { BookUser, Car, ChevronRight, IdCard, Lock } from "lucide-react";
import {
  IdvIllusStyles,
  IllusDocScan,
  IllusSelfie,
  IllusShield,
} from "./idv-illustrations";
import type { IdvDocumentType, IdvModePublic } from "@/lib/idv/types";

const DOC_ICONS: Record<string, typeof IdCard> = {
  dz_passport: BookUser,
  dz_cni: IdCard,
  dz_permis: Car,
};

const STEPS = [
  {
    Illus: IllusDocScan,
    title: "Scannez votre pièce",
    hint: "Cadrage guidé, photo auto",
  },
  {
    Illus: IllusSelfie,
    title: "Selfie rapide",
    hint: "Quelques secondes",
  },
  {
    Illus: IllusShield,
    title: "Vérification",
    hint: "Résultat immédiat",
  },
] as const;

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

  return (
    <div className="space-y-5 pb-6">
      <IdvIllusStyles />

      {/* Les 3 étapes, illustrées. */}
      <div className="space-y-2.5">
        {STEPS.map(({ Illus, title, hint }, i) => (
          <div
            key={title}
            className="flex items-center gap-3 rounded-[16px] p-3"
            style={{
              background: "var(--idv-card)",
              border: "1px solid var(--idv-line)",
            }}
          >
            <Illus size={64} />
            <div className="min-w-0">
              <p className="text-sm font-semibold">
                {i + 1}. {title}
              </p>
              <p className="text-xs" style={{ color: "var(--idv-muted)" }}>
                {hint}
              </p>
            </div>
          </div>
        ))}
      </div>

      {/* Choix du document. */}
      <div className="space-y-2">
        <p className="text-sm font-semibold">Votre document</p>
        <div className="space-y-2">
          {docTypes.map((doc) => {
            const Icon = DOC_ICONS[doc.key] ?? IdCard;
            const active = docKey === doc.key;
            return (
              <button
                key={doc.key}
                type="button"
                onClick={() => setDocKey(doc.key)}
                className="flex w-full items-center gap-3 rounded-[14px] border p-3 text-left transition-colors"
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
                  {doc.label_fr}
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
      </div>

      {/* Choix du mode (si le super-admin l'autorise). */}
      {canChooseMode && modes.length > 1 && (
        <div className="space-y-2">
          <p className="text-sm font-semibold">Niveau de vérification</p>
          <div className="grid grid-cols-2 gap-2">
            {modes.map((m) => {
              const active = modeKey === m.key;
              return (
                <button
                  key={m.key}
                  type="button"
                  onClick={() => setModeKey(m.key)}
                  className="rounded-[14px] border p-3 text-left"
                  style={{
                    background: active ? "var(--idv-soft)" : "var(--idv-card)",
                    borderColor: active
                      ? "var(--idv-accent)"
                      : "var(--idv-line)",
                  }}
                >
                  <p className="text-sm font-semibold">{m.label_fr}</p>
                  {m.description_fr && (
                    <p
                      className="mt-0.5 text-[11px] leading-snug"
                      style={{ color: "var(--idv-muted)" }}
                    >
                      {m.description_fr}
                    </p>
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}

      <button
        type="button"
        onClick={() => docKey && onStart(docKey, modeKey)}
        disabled={!docKey}
        className="flex w-full items-center justify-center gap-1.5 rounded-full py-3.5 text-sm font-semibold text-white transition-transform active:scale-[.98] disabled:opacity-50"
        style={{ background: "var(--idv-accent)" }}
      >
        Commencer
        <ChevronRight className="size-4" />
      </button>

      <p
        className="flex items-center justify-center gap-1.5 text-[11px]"
        style={{ color: "var(--idv-muted)" }}
      >
        <Lock className="size-3.5" />
        Données chiffrées, visibles uniquement par l&apos;équipe Coligo
      </p>
    </div>
  );
}
