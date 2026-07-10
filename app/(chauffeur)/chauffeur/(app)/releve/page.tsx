import { redirect } from "next/navigation";
import { getCurrentChauffeur } from "@/lib/auth/chauffeur";
import { parseSettlementPeriod } from "@/lib/driver/settlement-data";
import {
  currentMonthPeriod,
  getChauffeurFirstActivityMonth,
  getChauffeurReleve,
} from "@/lib/chauffeur/releve-data";
import { MoneyTabs } from "@/components/shared/money-tabs";
import { RelevePeriodPicker } from "@/components/driver/releve/period-picker";
import {
  BRAND_GO,
  BRAND_VIOLET,
  PartnerHeroCard,
  SORA,
} from "@/components/shared/partner-ui";
import { FileDown } from "lucide-react";

export const dynamic = "force-dynamic";

/**
 * RELEVÉ CHAUFFEUR par période (parité livreur) : mois courant par défaut,
 * n'importe quel mois depuis la première course, dates personnalisées. Le
 * PDF (/api/pdf/releve-chauffeur) reprend exactement la période affichée.
 * Sous-onglet du volet Gains (le hub matche /chauffeur/releve).
 */

function grp(n: number) {
  return String(Math.round(Math.abs(n))).replace(/\B(?=(\d{3})+(?!\d))/g, " ");
}

export default async function ChauffeurRelevePage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const ch = await getCurrentChauffeur();
  if (!ch) redirect("/chauffeur/login");

  const period = parseSettlementPeriod(params) ?? currentMonthPeriod();
  const [data, firstMonth] = await Promise.all([
    getChauffeurReleve(ch.id, period),
    getChauffeurFirstActivityMonth(ch.id),
  ]);

  const pdfQuery = params.month
    ? `?month=${params.month}`
    : params.from && params.to
      ? `?from=${params.from}&to=${params.to}`
      : "";

  return (
    <div className="drive-jakarta drive-page pt-safe pb-safe-nav min-h-screen bg-[var(--d-surface)] px-5">
      <div className="mx-auto max-w-md">
        <MoneyTabs base="/chauffeur" />

        <RelevePeriodPicker
          basePath="/chauffeur/releve"
          currentLabel={`Mois en cours (${currentMonthPeriod().label})`}
          firstMonth={firstMonth}
          selectedMonth={params.month ?? null}
          customFrom={params.from ?? null}
          customTo={params.to ?? null}
        />

        <PartnerHeroCard
          label={`Relevé · ${data.periodLabel}`}
          value={`${grp(data.netDa)} DA`}
          sub={`Net chauffeur · ${data.ridesCount} course${data.ridesCount > 1 ? "s" : ""}`}
        />

        {/* Détail qui réconcilie au net. */}
        <div className="mt-3 rounded-[18px] border border-[var(--d-line)] bg-[var(--d-surface)] px-3.5 py-1">
          <Line
            k="Revenus bruts (courses)"
            v={`+${grp(data.grossDa)} DA`}
            tone={BRAND_GO}
          />
          <Line k="Commission Coligo" v={`-${grp(data.commissionDa)} DA`} />
          {data.subFeesDa > 0 && (
            <Line
              k="Abonnements payés sur la période"
              v={`${grp(data.subFeesDa)} DA`}
            />
          )}
          <Line
            k="Net chauffeur"
            v={`${grp(data.netDa)} DA`}
            tone={BRAND_VIOLET}
            strong
          />
        </div>

        <a
          href={`/api/pdf/releve-chauffeur${pdfQuery}`}
          target="_blank"
          rel="noopener"
          className="mt-4 flex h-[52px] w-full items-center justify-center gap-2 rounded-[16px] text-[15px] font-bold text-white"
          style={{
            fontFamily: SORA,
            background: BRAND_VIOLET,
            boxShadow: "0 14px 28px -12px rgba(108,43,217,.6)",
          }}
        >
          <FileDown className="size-4" />
          Télécharger le relevé (PDF)
        </a>
      </div>
    </div>
  );
}

function Line({
  k,
  v,
  tone,
  strong,
}: {
  k: string;
  v: string;
  tone?: string;
  strong?: boolean;
}) {
  return (
    <div className="flex items-center justify-between border-b border-[var(--d-line)] py-3 text-[13.5px] last:border-b-0">
      <span
        className={strong ? "font-bold" : ""}
        style={{ color: strong ? "var(--d-ink)" : "var(--d-muted)" }}
      >
        {k}
      </span>
      <b
        style={{
          fontFamily: SORA,
          color: tone ?? "var(--d-ink)",
          fontSize: strong ? 16 : undefined,
        }}
      >
        {v}
      </b>
    </div>
  );
}
