"use client";

import { useState } from "react";
import { useLocale } from "next-intl";
import { FileDown, Loader2 } from "lucide-react";
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
  heroTitle,
  children,
}: {
  base: "/driver" | "/chauffeur";
  /** Mode HÉRO thémé (chauffeur) : le titre vit dans le bandeau MoneyTabs. */
  heroTitle?: string;
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
  const [pdfBusy, setPdfBusy] = useState(false);

  // Relevé PDF : on le RÉCUPÈRE avec la session (fetch same-origin → cookies
  // inclus) puis on le remet au navigateur en blob. Corrige le « bouton qui ne
  // fait rien » : en app Capacitor `target="_blank"` est inerte, et un onglet
  // intégré (Custom Tab) n'a PAS la session → 401. Ici le PDF se télécharge
  // vraiment, web comme mobile. Repli : ouverture directe.
  const downloadReleve = async () => {
    if (pdfBusy) return;
    setPdfBusy(true);
    try {
      const res = await fetch(pdfHref, { credentials: "include" });
      if (!res.ok) throw new Error(String(res.status));
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement("a");
      a.href = url;
      a.download =
        base === "/chauffeur"
          ? "releve-chauffeur-coligo.pdf"
          : "releve-livreur-coligo.pdf";
      document.body.appendChild(a);
      a.click();
      a.remove();
      setTimeout(() => URL.revokeObjectURL(url), 15000);
    } catch {
      window.open(pdfHref, "_blank", "noopener");
    } finally {
      setPdfBusy(false);
    }
  };

  const s = slices[filter];
  const brutDa = s.netDa + s.coligoDa;
  const filters: { id: PayFilter; label: string }[] = [
    { id: "all", label: tr("Tous", "الكل") },
    { id: "cash", label: tr("Espèces", "نقداً") },
    { id: "online", label: tr("En ligne", "عبر الإنترنت") },
  ];

  const verdictLabel =
    verdict.direction === "receive"
      ? tr("À recevoir de Coligo", "لك من كوليغو")
      : verdict.direction === "reverse"
        ? tr("À reverser à Coligo", "للتسديد إلى كوليغو")
        : tr("À jour avec Coligo", "على ما يرام مع كوليغو");

  return (
    <>
      {heroTitle ? (
        // Héro thémé : le titre vit DANS le bandeau (anti-doublon).
        <MoneyTabs base={base} heroTitle={heroTitle} />
      ) : (
        <>
          <h1
            className="text-display-sm mb-3 font-extrabold tracking-[-0.5px] text-[var(--d-ink)]"
            style={{ fontFamily: SORA }}
          >
            {tr("Gains et Relevés", "الأرباح والكشوف")}
          </h1>

          <MoneyTabs base={base} />
        </>
      )}

      {/* Filtres (période + moyen de paiement) — au-dessus du bloc unique. */}
      {periodPicker}

      <div className="rounded-card-lg mb-3 flex gap-[3px] bg-[var(--d-soft)] p-1">
        {filters.map((f) => (
          <button
            key={f.id}
            type="button"
            onClick={() => setFilter(f.id)}
            aria-pressed={filter === f.id}
            className="rounded-control-lg text-label-lg flex-1 p-2 text-center font-bold transition-colors"
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
      <div className="overflow-hidden rounded-lg border border-[var(--d-line)] bg-[var(--d-surface)]">
        {/* Net — le chiffre principal. */}
        <div className="px-4 pt-4 pb-3.5">
          <div className="text-label font-medium text-[var(--d-muted)] capitalize">
            {periodLabel}
          </div>
          <div
            className="mt-0.5 text-[30px] leading-none font-extrabold tracking-[-1px] text-[var(--d-ink)]"
            style={{ fontFamily: SORA }}
          >
            {grp(s.netDa)} {DA}
          </div>
          <div className="text-label-lg mt-1.5 text-[var(--d-muted)]">
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
            <span className="text-body-lg font-bold text-[var(--d-ink)]">
              {verdictLabel}
            </span>
            {verdict.direction !== "settled" && (
              <span
                className="text-title-lg shrink-0 font-extrabold text-[var(--d-ink)]"
                style={{ fontFamily: SORA }}
              >
                {grp(verdict.amountDa)} {DA}
              </span>
            )}
          </div>
          {verdict.direction === "settled" ? (
            <p className="text-label mt-1 text-[var(--d-muted)]">
              {tr("Rien à régler.", "لا شيء للتسوية.")}
            </p>
          ) : (
            verdict.dueLabel &&
            verdict.dueLabel
              .split("·")
              .map((part) => part.trim())
              .filter(Boolean)
              .map((part, i) => (
                <p key={i} className="text-label mt-1 text-[var(--d-muted)]">
                  {part}
                </p>
              ))
          )}
        </div>

        {/* Relevé PDF — action simple, même bloc (téléchargement authentifié). */}
        <button
          type="button"
          onClick={() => void downloadReleve()}
          disabled={pdfBusy}
          className="text-body flex w-full items-center justify-center gap-2 border-t border-[var(--d-line)] py-3.5 font-bold text-[var(--d-ink)] disabled:opacity-60"
        >
          {pdfBusy ? (
            <Loader2 className="size-4 animate-spin" />
          ) : (
            <FileDown className="size-4" />
          )}
          {tr("Relevé PDF", "كشف PDF")}
        </button>
      </div>

      {children}
    </>
  );
}

/** Ligne de relevé (libellé à gauche, montant à droite) — neutre, sans fond. */
function Row({ k, v }: { k: string; v: string }) {
  return (
    <div className="text-body flex items-center justify-between gap-3 border-t border-[var(--d-line)] px-4 py-3">
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
