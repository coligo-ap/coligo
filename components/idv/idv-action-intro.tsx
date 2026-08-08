"use client";

// =============================================================================
// IDV — ÉCRAN D'ANNONCE d'une action, affiché JUSTE AVANT elle (jamais les
// trois étapes d'un coup : chaque explication arrive au moment où elle sert).
// Grande illustration animée, une phrase, un bouton. C'est le rythme des
// grands acteurs de la vérification d'identité : « on vous dit ce qu'on va
// faire, puis on le fait ».
// =============================================================================

import { ArrowRight } from "lucide-react";
import { useLocale } from "next-intl";
import { IdvIllusStyles } from "./idv-illustrations";

export function IdvActionIntro({
  illustration,
  eyebrow,
  title,
  hint,
  cta,
  onStart,
  pending = false,
  error = null,
  children,
}: {
  illustration: React.ReactNode;
  /** Ex. « Étape 1 sur 3 ». */
  eyebrow: string;
  title: string;
  hint: string;
  cta: string;
  onStart: () => void;
  pending?: boolean;
  error?: string | null;
  /** Contenu optionnel intercalé (ex. choix du document). */
  children?: React.ReactNode;
}) {
  const isAr = useLocale() === "ar";
  return (
    <div className="flex min-h-[58vh] flex-col">
      <IdvIllusStyles />
      <style>{`
        @keyframes idv-action-in {
          from { opacity: 0; transform: translateY(10px); }
          to   { opacity: 1; transform: none; }
        }
        .idv-action { animation: idv-action-in .34s cubic-bezier(.22,1,.36,1); }
        @media (prefers-reduced-motion: reduce) { .idv-action { animation: none; } }
      `}</style>

      <div className="idv-action flex flex-col items-center text-center">
        {illustration}
        <p
          className="text-caption mt-5 font-semibold tracking-wide uppercase"
          style={{ color: "var(--idv-accent)" }}
        >
          {eyebrow}
        </p>
        <h2 className="mt-1 text-xl font-bold tracking-tight">{title}</h2>
        <p
          className="mt-2 max-w-[290px] text-sm leading-relaxed"
          style={{ color: "var(--idv-muted)" }}
        >
          {hint}
        </p>
      </div>

      {children && <div className="mt-6 flex-1">{children}</div>}
      {!children && <div className="flex-1" />}

      {error && (
        <p
          className="mb-3 rounded-md px-3 py-2.5 text-sm"
          style={{ background: "rgba(239,68,68,.12)", color: "var(--idv-bad)" }}
        >
          {error}
        </p>
      )}

      <button
        type="button"
        onClick={onStart}
        disabled={pending}
        className="flex w-full items-center justify-center gap-1.5 rounded-full py-3.5 text-sm font-semibold text-white transition-transform active:scale-[.98] disabled:opacity-60"
        style={{ background: "var(--idv-accent)" }}
      >
        {pending ? (isAr ? "جارٍ التحضير…" : "Préparation…") : cta}
        {!pending && <ArrowRight className="size-4 rtl:rotate-180" />}
      </button>
    </div>
  );
}
