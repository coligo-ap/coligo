"use client";

// =============================================================================
// ONBOARDING — bulle « (i) ». Les textes longs (mentions légales, pourquoi on
// demande telle pièce…) ne s'affichent PAS à l'écran : ils vivent derrière une
// petite icône d'information. L'écran reste court, l'utilisateur lit s'il en a
// envie. Repère des néobanques : une seule idée visible à la fois.
// =============================================================================

import { useState } from "react";
import { useLocale } from "next-intl";
import { Info, X } from "lucide-react";
import { Portal } from "@/components/ui/portal";

export function InfoNote({
  title,
  children,
  label,
}: {
  title: string;
  children: React.ReactNode;
  label?: string;
}) {
  const [open, setOpen] = useState(false);
  const isAr = useLocale() === "ar";
  const shownLabel = label ?? (isAr ? "اعرف المزيد" : "En savoir plus");

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={shownLabel}
        className="inline-flex size-6 items-center justify-center rounded-full border border-[var(--line)] bg-[var(--surface)] align-middle text-[var(--muted)] transition-colors hover:text-[var(--ink)]"
      >
        <Info className="size-3.5" />
      </button>

      {open && (
        <Portal>
          <div
            className="fixed inset-0 z-[95] flex items-end justify-center bg-black/45 sm:items-center"
            onClick={() => setOpen(false)}
          >
            <div
              className="w-full max-w-md rounded-t-[22px] bg-[var(--surface)] p-5 pb-[calc(env(safe-area-inset-bottom)+20px)] text-start sm:rounded-[22px] sm:pb-5"
              style={{ animation: "driver-rise .28s ease-out both" }}
              onClick={(e) => e.stopPropagation()}
            >
              <div className="mb-2 flex items-start justify-between gap-3">
                <p className="text-[15px] font-bold text-[var(--ink)]">
                  {title}
                </p>
                <button
                  type="button"
                  onClick={() => setOpen(false)}
                  aria-label={isAr ? "إغلاق" : "Fermer"}
                  className="grid size-8 shrink-0 place-items-center rounded-full border border-[var(--line)]"
                >
                  <X className="size-4" />
                </button>
              </div>
              <div className="text-[13px] leading-relaxed text-[var(--muted)]">
                {children}
              </div>
            </div>
          </div>
        </Portal>
      )}
    </>
  );
}
