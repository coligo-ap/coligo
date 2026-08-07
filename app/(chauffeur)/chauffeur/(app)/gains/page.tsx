import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
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

export default async function ChauffeurGainsPage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const ch = await getCurrentChauffeur();
  if (!ch) redirect("/chauffeur/login");
  const isAr = (await getLocale()) === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);

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
  if ((fin?.planRate ?? 0) > 0)
    dueParts.push(tr("commissions sur courses", "عمولات على المشاوير"));
  if ((fin?.monthSubFee ?? 0) > 0) dueParts.push(tr("abonnement", "اشتراك"));
  const dueLabel =
    due > 0
      ? `${dueParts.join(" + ") || tr("montant dû", "مبلغ مستحق")} · ${tr("avant le 5 du mois", "قبل الخامس من الشهر")} · CCP / BaridiMob`
      : null;

  return (
    <div className="drive-jakarta drive-page pb-safe-nav min-h-screen bg-[var(--d-surface)] px-5">
      <div className="mx-auto max-w-md">
        <GainsReleveView
          base="/chauffeur"
          heroTitle={tr("Gains et Relevés", "الأرباح والكشوف")}
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
              currentLabel={
                isAr
                  ? `الشهر الجاري (${currentMonthPeriod().label})`
                  : `Mois en cours (${currentMonthPeriod().label})`
              }
              firstMonth={firstMonth}
              selectedMonth={params.month ?? null}
              customFrom={params.from ?? null}
              customTo={params.to ?? null}
            />
          }
        >
          {/* Ventilation COVOITURAGE (0444) — les montants sont DÉJÀ inclus
              dans le relevé ci-dessus ; cette ligne dit d'où ils viennent. */}
          {data.carpool.netDa > 0 && (
            <p className="mt-2.5 rounded-[12px] bg-[var(--d-soft)] px-3.5 py-2.5 text-[12px] font-semibold text-[var(--d-muted)]">
              {tr("dont covoiturage", "منها مشاركة المشوار")} :{" "}
              <b className="text-[var(--d-ink)]">
                {data.carpool.tripsCount}{" "}
                {isAr
                  ? "رحلة"
                  : `départ${data.carpool.tripsCount > 1 ? "s" : ""}`}
              </b>{" "}
              · {data.carpool.seatsCount}{" "}
              {isAr ? "مقعد" : `place${data.carpool.seatsCount > 1 ? "s" : ""}`}{" "}
              ·{" "}
              <b className="text-[var(--d-ink)]">
                +{data.carpool.netDa} {tr("DA net", "دج صافي")}
              </b>
            </p>
          )}
        </GainsReleveView>
        {/* Page 100 % revenus (règle « zéro doublon ») : le raccourci
            Abonnement et le solde Coligo Pay vivent sur LEURS pages
            (Compte → Abonnement · onglet Coligo Pay). */}
      </div>
    </div>
  );
}
