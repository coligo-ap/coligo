"use client";

import { useState } from "react";
import { useLocale } from "next-intl";
import { MoneyTabs } from "@/components/shared/money-tabs";
import { SettlementVerdict } from "@/components/partner/money-overview";
import { PartnerHeroCard, SORA } from "@/components/shared/partner-ui";

/**
 * PAGE UNIQUE « Gains et Relevés » (livreur ET chauffeur) — style Bolt :
 * gains + relevé + versement en UNE page à sections, copy minimale. Le
 * partenaire lit d'abord son NET et la commission Coligo ; les composantes
 * internes (commissions commerçants, frais de service…) ne sont PAS montrées
 * — le verdict « à reverser / à recevoir » suffit. Le gain du jour vit sur
 * l'ACCUEIL (zéro doublon ici).
 *
 * Filtre paiement (Tous · Espèces · En ligne) 100 % CLIENT : les agrégats par
 * méthode arrivent pré-calculés du serveur, la bascule est instantanée (cf.
 * CLAUDE.md « zéro round-trip serveur »). Le verdict, lui, reste GLOBAL : le
 * solde avec Coligo ne dépend pas du filtre d'affichage.
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
  const [filter, setFilter] = useState<PayFilter>("all");

  const s = slices[filter];
  const brutDa = s.netDa + s.coligoDa;
  const filters: { id: PayFilter; label: string }[] = [
    { id: "all", label: tr("Tous", "الكل") },
    { id: "cash", label: tr("Espèces", "نقداً") },
    { id: "online", label: tr("En ligne", "عبر الإنترنت") },
  ];

  return (
    <>
      {/* Titre demandé produit : « Gains et Relevés » (une seule page). */}
      <h1
        className="mb-3 text-[21px] font-extrabold tracking-[-0.5px] text-[var(--d-ink)]"
        style={{ fontFamily: SORA }}
      >
        {tr("Gains et Relevés", "الأرباح والكشوف")}
      </h1>

      <MoneyTabs base={base} />

      {/* Période (mois / dates) — pilote la page ET le PDF. */}
      {periodPicker}

      {/* Filtre paiement — état local, bascule instantanée. */}
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

      {/* NET — LE chiffre que le partenaire vient chercher, avec son détail
          (brut → commission) DANS la même carte. Zéro doublon : le Net
          n'apparaît qu'UNE fois (le grand chiffre) ; les lignes l'expliquent.
          Une seule carte au lieu de deux → plus compact, lu d'un coup d'œil. */}
      <PartnerHeroCard
        label={`${tr("Net", "الصافي")} · ${periodLabel}${
          filter === "cash"
            ? ` · ${tr("espèces", "نقداً")}`
            : filter === "online"
              ? ` · ${tr("en ligne", "عبر الإنترنت")}`
              : ""
        }`}
        value={`${grp(s.netDa)} ${tr("DA", "دج")}`}
        sub={`${s.count} ${tr(s.count > 1 ? "courses" : "course", "توصيلة")}`}
      >
        <div className="mt-4 rounded-[14px] bg-white/12 px-3.5">
          <HeroLine
            k={tr("Brut", "الإجمالي")}
            v={`+${grp(brutDa)} ${tr("DA", "دج")}`}
          />
          <HeroLine
            k={tr("Commission Coligo", "عمولة كوليغو")}
            v={`−${grp(s.coligoDa)} ${tr("DA", "دج")}`}
          />
          {filter === "all" && subFeesDa > 0 && (
            <HeroLine
              k={tr("Abonnements", "الاشتراكات")}
              v={`−${grp(subFeesDa)} ${tr("DA", "دج")}`}
            />
          )}
        </div>
      </PartnerHeroCard>

      {/* VERSEMENT — où j'en suis avec Coligo (global) + PDF. */}
      <SettlementVerdict
        direction={verdict.direction}
        amountDa={verdict.amountDa}
        dueLabel={verdict.dueLabel}
        pdfHref={pdfHref}
      />

      {children}
    </>
  );
}

/** Ligne de détail SUR la carte héro (blanc sur violet) — explique le Net
 *  sans le répéter : brut, commission Coligo, (abonnements). */
function HeroLine({ k, v }: { k: string; v: string }) {
  return (
    <div className="flex items-center justify-between border-b border-white/15 py-2.5 text-[13px] text-white last:border-b-0">
      <span className="opacity-85">{k}</span>
      <b style={{ fontFamily: SORA }}>{v}</b>
    </div>
  );
}
