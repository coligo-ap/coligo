import Link from "next/link";
import { redirect } from "next/navigation";
import { ChevronRight, Crown } from "lucide-react";
import { getCurrentChauffeur } from "@/lib/auth/chauffeur";
import { parseSettlementPeriod } from "@/lib/driver/settlement-data";
import {
  currentMonthPeriod,
  getChauffeurFirstActivityMonth,
  getChauffeurReleve,
} from "@/lib/chauffeur/releve-data";
import { getChauffeurFinances } from "@/app/(chauffeur)/actions";
import { GainsReleveView } from "@/components/partner/gains-releve";
import { RelevePeriodPicker } from "@/components/driver/releve/period-picker";

export const dynamic = "force-dynamic";

/**
 * « GAINS ET RELEVÉS » chauffeur — page UNIQUE (style Bolt) qui fusionne
 * l'ancien volet Gains et l'ancienne page /chauffeur/releve : net + commission
 * Coligo, filtre paiement (Tous · Espèces · En ligne), verdict « à reverser »
 * + PDF. Sommes = snapshots figés (getChauffeurReleve, source partagée avec
 * le PDF). Le gain du jour vit sur l'accueil (zéro doublon).
 */

// Libellés de plans (local : d-ui est un module client, non importable ici
// pour de simples données). Violet de marque : constante (stable clair/sombre),
// même pattern que BRAND_VIOLET de partner-ui (module client, non importable).
const PLAN_LABEL: Record<string, string> = {
  free: "Gratuit",
  pro: "Pro",
  premium: "Premium",
};
const BRAND_VIOLET = "#6C2BD9";

export default async function ChauffeurGainsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const ch = await getCurrentChauffeur();
  if (!ch) redirect("/chauffeur/login");

  const period = parseSettlementPeriod(params) ?? currentMonthPeriod();
  const [data, firstMonth, fin] = await Promise.all([
    getChauffeurReleve(ch.id, period),
    getChauffeurFirstActivityMonth(ch.id),
    // Verdict « à reverser » (non réglé) + plan courant — même source que
    // l'ancien volet Gains (d-gains).
    getChauffeurFinances(),
  ]);

  // Le PDF reprend EXACTEMENT la période affichée.
  const pdfQuery = params.month
    ? `?month=${params.month}`
    : params.from && params.to
      ? `?from=${params.from}&to=${params.to}`
      : "";

  // « À reverser » ADAPTATIF (aucun plan/taux en dur) : au lancement (0 % de
  // commission, sans abonnement payant), rien à reverser → « à jour ».
  const due = fin?.dueUnsettled ?? 0;
  const dueParts: string[] = [];
  if ((fin?.planRate ?? 0) > 0) dueParts.push("commissions sur courses");
  if ((fin?.monthSubFee ?? 0) > 0) dueParts.push("abonnement");
  const dueLabel =
    due > 0
      ? `${dueParts.join(" + ") || "montant dû"} · avant le 5 du mois · CCP / BaridiMob`
      : null;

  return (
    <div className="drive-jakarta drive-page pt-safe pb-safe-nav min-h-screen bg-[var(--d-surface)] px-5">
      <div className="mx-auto max-w-md">
        <GainsReleveView
          base="/chauffeur"
          periodLabel={data.periodLabel}
          slices={data.byMethod}
          subFeesDa={data.subFeesDa}
          verdict={{
            direction: due > 0 ? "reverse" : "settled",
            amountDa: due,
            dueLabel,
          }}
          pdfHref={`/api/pdf/releve-chauffeur${pdfQuery}`}
          periodPicker={
            <RelevePeriodPicker
              basePath="/chauffeur/gains"
              currentLabel={`Mois en cours (${currentMonthPeriod().label})`}
              firstMonth={firstMonth}
              selectedMonth={params.month ?? null}
              customFrom={params.from ?? null}
              customTo={params.to ?? null}
            />
          }
        >
          {/* Abonnement — ADAPTATIF, une ligne, le détail vit sur sa page. */}
          <Link
            href="/chauffeur/abonnement"
            className="mb-3 flex w-full items-center gap-2.5 rounded-[15px] border border-[var(--d-line)] bg-[var(--d-surface)] p-3"
          >
            <span className="grid size-9 shrink-0 place-items-center rounded-[11px] bg-[var(--d-accent)] text-[var(--d-ink)]">
              <Crown className="size-[18px]" style={{ color: BRAND_VIOLET }} />
            </span>
            <span className="min-w-0 flex-1">
              <b className="block text-[13.5px] text-[var(--d-ink)]">
                Abonnement : {PLAN_LABEL[fin?.plan ?? "free"] ?? "Gratuit"}
              </b>
              <span className="text-[11px] text-[var(--d-muted)]">
                {(fin?.planRate ?? 0) <= 0
                  ? "0 % de commission"
                  : "Réduire ma commission"}
              </span>
            </span>
            <ChevronRight className="size-4 shrink-0 text-[var(--d-muted)] rtl:rotate-180" />
          </Link>
        </GainsReleveView>
      </div>
    </div>
  );
}
