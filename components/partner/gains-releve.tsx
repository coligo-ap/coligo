"use client";

import { useState } from "react";
import { useLocale } from "next-intl";
import { FileDown } from "lucide-react";
import { MoneyTabs } from "@/components/shared/money-tabs";
import { SORA } from "@/components/shared/partner-ui";

/**
 * PAGE UNIQUE « Gains et Relevés » (livreur ET chauffeur) — RELEVÉ SIMPLE.
 *
 * Choix produit (demande explicite) : UN SEUL bloc, en LISTE claire façon reçu,
 * SANS aucun fond coloré de carte. Chaque ligne = un libellé à gauche, un
 * montant à droite. Objectif : compréhension immédiate, même pour un livreur /
 * chauffeur peu à l'aise avec le numérique. Pas de séparateurs « · » ni « : »
 * qui alourdissent la lecture.
 *
 * Ordre de lecture, de haut en bas, dans le MÊME bloc :
 *   période → Net (le grand chiffre) → nombre de courses → Brut → Commission
 *   Coligo → (Abonnements) → verdict de versement (à reverser / Coligo vous
 *   doit / à jour) → Relevé PDF.
 *
 * Filtre paiement (Tous · Espèces · En ligne) 100 % CLIENT : agrégats
 * pré-calculés serveur, bascule instantanée. Le verdict reste GLOBAL.
 */

export type GainsSlice = {
  count: number;
  /** Net partenaire (ce qui lui reste). */
  netDa: number;
  /** Part Coligo (commission / part plateforme) sur ces courses. */
  coligoDa: number;
};

export type GainsSlices = {
  all: GainsSlice;
  cash: GainsSlice;
  online: GainsSlice;
};

type PayFilter = "all" | "cash" | "online";

function grp(n: number) {
  return String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export function GainsReleveView({
  base,
  periodLabel,
  slices,
  subFeesDa = 0,
  verdict,
  pdfHref,
  periodPicker,
  children,
}: {
  base: "/driver" | "/chauffeur";
  periodLabel: string;
  slices: GainsSlices;
  /** Abonnements payés sur la période (chauffeur) — affiché sur « Tous ». */
  subFeesDa?: number;
  /** Solde GLOBAL avec Coligo (indépendant du filtre). */
  verdict: {
    direction: "reverse" | "receive" | "settled";
    amountDa: number;
    dueLabel?: string | null;
  };
  pdfHref: string;
  periodPicker: React.ReactNode;
  /** Sections propres à l'espace (réclamations no-show, CTA abonnement…). */
  children?: React.ReactNode;
}) {
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  const DA = tr("DA", "دج");
  const [filter, setFilter] = useState<PayFilter>("all");

  const s = slices[filter];
  const brutDa = s.netDa + s.coligoDa;
  const filters: { id: PayFilter; label: string }[] = [
    { id: "all", label: tr("Tous", "الكل") },
    { id: "cash", label: tr("Espèces", "نقداً") },
    { id: "online", label: tr("En ligne", "عبر الإنترنت") },
  ];

  const verdictLabel =
    verdict.direction === "receive"
      ? tr("Coligo vous doit", "كوليغو مدينة لك")
      : verdict.direction === "reverse"
        ? tr("À reverser à Coligo", "للتسديد إلى كوليغو")
        : tr("À jour avec Coligo", "على ما يرام مع كوليغو");

  return (
    <>
      <h1
        className="mb-3 text-[21px] font-extrabold tracking-[-0.5px] text-[var(--d-ink)]"
        style={{ fontFamily: SORA }}
      >
        {tr("Gains et Relevés", "الأرباح والكشوف")}
      </h1>

      <MoneyTabs base={base} />

      {/* Filtres (période + moyen de paiement) — au-dessus du bloc unique. */}
      {periodPicker}

      <div className="mb-3 flex gap-[3px] rounded-[14px] bg-[var(--d-soft)] p-1">
        {filters.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            aria-pressed={filter === f.id}
            className="flex-1 rounded-[11px] p-2 text-center text-[12.5px] font-bold transition-colors"
            style={
              filter === f.id
                ? {
                    fontFamily: SORA,
                    background: "var(--d-surface)",
                    color: "var(--d-ink)",
                    boxShadow: "0 4px 12px -6px rgba(0,0,0,.25)",
                  }
                : { color: "var(--d-muted)" }
            }
          >
            {f.label}
          </button>
        ))}
      </div>

      {/* UN SEUL BLOC — relevé simple, aucun fond coloré, tout en lignes
          claires. Se lit d'un coup d'œil, de haut en bas. */}
      <div className="overflow-hidden rounded-[16px] border border-[var(--d-line)] bg-[var(--d-surface)]">
        {/* Net — le chiffre principal. */}
        <div className="px-4 pt-4 pb-3.5">
          <div className="text-[12px] font-medium text-[var(--d-muted)] capitalize">
            {periodLabel}
          </div>
          <div
            className="mt-0.5 text-[30px] leading-none font-extrabold tracking-[-1px] text-[var(--d-ink)]"
            style={{ fontFamily: SORA }}
          >
            {grp(s.netDa)} {DA}
          </div>
          <div className="mt-1.5 text-[12.5px] text-[var(--d-muted)]">
            {s.count} {tr(s.count > 1 ? "courses" : "course", "توصيلة")}
            {filter === "cash"
              ? ` ${tr("en espèces", "نقداً")}`
              : filter === "online"
                ? ` ${tr("en ligne", "عبر الإنترنت")}`
                : ""}
          </div>
        </div>

        {/* Détail — lignes simples (libellé à gauche, montant à droite). */}
        <Row k={tr("Brut", "الإجمالي")} v={`${grp(brutDa)} ${DA}`} />
        <Row
          k={tr("Commission Coligo", "عمولة كوليغو")}
          v={`− ${grp(s.coligoDa)} ${DA}`}
        />
        {filter === "all" && subFeesDa > 0 && (
          <Row
            k={tr("Abonnements", "الاشتراكات")}
            v={`− ${grp(subFeesDa)} ${DA}`}
          />
        )}

        {/* Verdict de versement — même bloc, ligne mise en avant. */}
        <div className="border-t border-[var(--d-line)] px-4 py-3.5">
          <div className="flex items-center justify-between gap-3">
            <span className="text-[14px] font-bold text-[var(--d-ink)]">
              {verdictLabel}
            </span>
            {verdict.direction !== "settled" && (
              <span
                className="shrink-0 text-[17px] font-extrabold text-[var(--d-ink)]"
                style={{ fontFamily: SORA }}
              >
                {grp(verdict.amountDa)} {DA}
              </span>
            )}
          </div>
          {verdict.direction === "settled" ? (
            <p className="mt-1 text-[12px] text-[var(--d-muted)]">
              {tr("Rien à régler.", "لا شيء للتسوية.")}
            </p>
          ) : (
            verdict.dueLabel &&
            verdict.dueLabel
              .split("·")
              .map((part) => part.trim())
              .filter(Boolean)
              .map((part, i) => (
                <p key={i} className="mt-1 text-[12px] text-[var(--d-muted)]">
                  {part}
                </p>
              ))
          )}
        </div>

        {/* Relevé PDF — action simple, même bloc. */}
        <a
          href={pdfHref}
          target="_blank"
          rel="noopener"
          className="flex items-center justify-center gap-2 border-t border-[var(--d-line)] py-3.5 text-[13.5px] font-bold text-[var(--d-ink)]"
        >
          <FileDown className="size-4" /> {tr("Relevé PDF", "كشف PDF")}
        </a>
      </div>

      {children}
    </>
  );
}

/** Ligne de relevé (libellé à gauche, montant à droite) — neutre, sans fond. */
function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between gap-3 border-t border-[var(--d-line)] px-4 py-3 text-[13.5px]">
      <span className="text-[var(--d-muted)]">{k}</span>
      <span
        className="shrink-0 font-semibold text-[var(--d-ink)]"
        style={{ fontFamily: SORA }}
      >
        {v}
      </span>
    </div>
  );
}
