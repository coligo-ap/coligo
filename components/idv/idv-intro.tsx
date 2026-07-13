"use client";

// =============================================================================
// IDV — INTRO du parcours, présentée ÉTAPE PAR ÉTAPE (une seule à l'écran).
// Chaque étape occupe tout l'espace : son illustration animée, une phrase
// courte, un bouton « Suivant ». L'utilisateur n'a jamais qu'UNE chose à lire
// (repère Bolt / grands acteurs de la vérification d'identité) — plus de liste
// des 3 étapes empilées sur la première page.
// Après les 3 étapes : le choix du document (et du niveau, si autorisé).
// =============================================================================

import { useState } from "react";
import {
  ArrowRight,
  BookUser,
  Car,
  ChevronRight,
  IdCard,
  Lock,
} from "lucide-react";
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

const SLIDES = [
  {
    Illus: IllusDocScan,
    title: "Scannez votre pièce",
    hint: "Le cadrage est guidé, la photo se prend toute seule.",
  },
  {
    Illus: IllusSelfie,
    title: "Selfie rapide",
    hint: "Quelques gestes simples pour prouver que c'est bien vous.",
  },
  {
    Illus: IllusShield,
    title: "Vérification",
    hint: "Votre pièce et votre visage sont comparés. Résultat immédiat.",
  },
] as const;

function IntroStyles() {
  return (
    <style>{`
      @keyframes idv-slide-in {
        from { opacity: 0; transform: translateX(18px); }
        to   { opacity: 1; transform: none; }
      }
      .idv-slide { animation: idv-slide-in .34s cubic-bezier(.22,1,.36,1); }
      @media (prefers-reduced-motion: reduce) { .idv-slide { animation: none; } }
    `}</style>
  );
}

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
  /** 0-2 = les 3 étapes expliquées, une par écran ; 3 = choix du document. */
  const [slide, setSlide] = useState(0);
  const [docKey, setDocKey] = useState(docTypes[0]?.key ?? "");
  const [modeKey, setModeKey] = useState(
    modes.some((m) => m.key === defaultMode)
      ? defaultMode
      : (modes[0]?.key ?? "")
  );

  // ── Les 3 étapes, UNE À LA FOIS ────────────────────────────────────────────
  if (slide < SLIDES.length) {
    const { Illus, title, hint } = SLIDES[slide];
    return (
      <div className="flex min-h-[60vh] flex-col">
        <IdvIllusStyles />
        <IntroStyles />

        <div
          key={slide}
          className="idv-slide flex flex-1 flex-col items-center justify-center text-center"
        >
          <Illus size={132} />
          <p
            className="mt-6 text-[11px] font-semibold tracking-wide uppercase"
            style={{ color: "var(--idv-accent)" }}
          >
            Étape {slide + 1} sur {SLIDES.length}
          </p>
          <h2 className="mt-1 text-xl font-bold tracking-tight">{title}</h2>
          <p
            className="mt-2 max-w-[280px] text-sm leading-relaxed"
            style={{ color: "var(--idv-muted)" }}
          >
            {hint}
          </p>
        </div>

        {/* Points de progression. */}
        <div className="mb-4 flex justify-center gap-1.5">
          {SLIDES.map((s, i) => (
            <span
              key={s.title}
              className="h-1.5 rounded-full transition-all duration-300"
              style={{
                width: i === slide ? 22 : 6,
                background:
                  i <= slide ? "var(--idv-accent)" : "var(--idv-line)",
              }}
            />
          ))}
        </div>

        <button
          type="button"
          onClick={() => setSlide((n) => n + 1)}
          className="flex w-full items-center justify-center gap-1.5 rounded-full py-3.5 text-sm font-semibold text-white transition-transform active:scale-[.98]"
          style={{ background: "var(--idv-accent)" }}
        >
          {slide === SLIDES.length - 1 ? "J'ai compris" : "Suivant"}
          <ArrowRight className="size-4" />
        </button>

        {slide < SLIDES.length - 1 && (
          <button
            type="button"
            onClick={() => setSlide(SLIDES.length)}
            className="mt-2 py-1 text-xs"
            style={{ color: "var(--idv-muted)" }}
          >
            Passer
          </button>
        )}
      </div>
    );
  }

  // ── Choix du document (et du niveau) ──────────────────────────────────────
  return (
    <div className="idv-slide space-y-5 pb-6">
      <IdvIllusStyles />
      <IntroStyles />

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
                    background: active ? "var(--idv-tint)" : "var(--idv-card)",
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
