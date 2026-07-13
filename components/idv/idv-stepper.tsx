"use client";

// =============================================================================
// IDV — FIL D'ARIANE du parcours. Présent sur TOUS les écrans (y compris
// par-dessus la caméra) : à chaque instant l'utilisateur sait où il en est,
// combien il reste, et ce qui est déjà acquis — la règle des grands acteurs
// de la vérification d'identité.
//
// 3 étapes : Document → Selfie → Vérification. Le libellé de la sous-étape
// (« Recto », « Verso », « Tournez la tête »…) s'affiche sous la barre.
// 100 % CSS local, thème-aware, prefers-reduced-motion respecté.
// =============================================================================

import { Check } from "lucide-react";

export type IdvStepKey = "document" | "selfie" | "decision";

const STEPS: { key: IdvStepKey; label: string }[] = [
  { key: "document", label: "Document" },
  { key: "selfie", label: "Selfie" },
  { key: "decision", label: "Vérification" },
];

export function IdvStepperStyles() {
  return (
    <style>{`
      @keyframes idv-step-in {
        from { opacity: 0; transform: translateY(3px); }
        to   { opacity: 1; transform: none; }
      }
      @keyframes idv-bar-grow { from { transform: scaleX(0); } to { transform: scaleX(1); } }
      .idv-step-sub { animation: idv-step-in .28s ease-out; }
      .idv-bar-fill {
        transform-origin: left center;
        animation: idv-bar-grow .5s cubic-bezier(.22,1,.36,1);
      }
      @media (prefers-reduced-motion: reduce) {
        .idv-step-sub, .idv-bar-fill { animation: none; }
      }
    `}</style>
  );
}

export function IdvStepper({
  current,
  /** Sous-étape en cours (ex. « Recto », « Tournez la tête à gauche »). */
  hint,
  /** Progression 0-1 DANS l'étape courante (remplit la barre). */
  progress = 0,
  /** Rendu sur fond sombre (par-dessus la caméra). */
  onDark = false,
}: {
  current: IdvStepKey;
  hint?: string | null;
  progress?: number;
  onDark?: boolean;
}) {
  const index = STEPS.findIndex((s) => s.key === current);
  const ink = onDark ? "#fff" : "var(--idv-ink)";
  const muted = onDark ? "rgba(255,255,255,.65)" : "var(--idv-muted)";
  const track = onDark ? "rgba(255,255,255,.22)" : "var(--idv-line)";
  const accent = onDark ? "#fff" : "var(--idv-accent)";
  const done = "var(--idv-ok)";

  return (
    <div className="w-full">
      <IdvStepperStyles />
      <div className="flex items-center gap-1.5">
        {STEPS.map((step, i) => {
          const isDone = i < index;
          const isCurrent = i === index;
          // L'étape EN COURS montre toujours un minimum de remplissage : une
          // barre vide donne l'impression que rien n'a commencé.
          const fill = isDone
            ? 1
            : isCurrent
              ? Math.max(0.12, Math.min(1, progress))
              : 0;
          return (
            <div key={step.key} className="flex flex-1 flex-col gap-1">
              <div
                className="h-1 w-full overflow-hidden rounded-full"
                style={{ background: track }}
              >
                <div
                  className={
                    fill > 0 ? "idv-bar-fill h-full rounded-full" : "h-full"
                  }
                  style={{
                    width: `${fill * 100}%`,
                    background: isDone ? done : accent,
                    transition: "width .45s cubic-bezier(.22,1,.36,1)",
                  }}
                />
              </div>
              <span
                className="flex items-center gap-1 text-[10px] font-medium"
                style={{
                  color: isDone || isCurrent ? ink : muted,
                  opacity: isDone || isCurrent ? 1 : 0.7,
                }}
              >
                {isDone && (
                  <Check
                    className="size-3"
                    style={{ color: done }}
                    aria-hidden
                  />
                )}
                {step.label}
              </span>
            </div>
          );
        })}
      </div>
      {hint && (
        <p
          key={hint}
          className="idv-step-sub mt-1 text-[11px]"
          style={{ color: muted }}
        >
          {hint}
        </p>
      )}
    </div>
  );
}
