import { getWalletEntriesPage, getWalletSummary } from "@/lib/data/wallet";
import { getMyWalletState } from "@/app/wallet/recharge-actions";
import { getPayoutHistory } from "@/lib/data/payout-statements";
import { resolvePeriod } from "@/lib/finances/period";
import { reservedAmount } from "@/lib/finances/balance";
import { computeNextPayout, type NextPayout } from "@/lib/finances/next-payout";
import { cashDebtStatus, type CashDebtStatus } from "@/lib/finances/cash-debt";
import { getPlatformSettings } from "@/lib/data/platform";
import { FinancesView } from "@/components/merchant/finances/finances-view";
import { MerchantMoneyTabs } from "@/components/shared/money-tabs";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 10;

function parsePage(raw?: string): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

export default async function FinancesPage({
  searchParams,
}: {
  searchParams: Promise<{
    page?: string;
    type?: string;
    period?: string;
    from?: string;
    to?: string;
  }>;
}) {
  const sp = await searchParams;
  const page = parsePage(sp.page);

  // Filtre de période PARTAGÉ du module Paiements (versements + opérations).
  // Préréglages résolus en bornes ISO [from, to) heure d'Alger — défaut « Ce
  // mois » ; « custom » = dates libres AAAA-MM-JJ de l'URL.
  const period = resolvePeriod(sp.period, sp.from, sp.to);
  const entryFilters = {
    type: sp.type || null,
    from: period.fromIso,
    to: period.toIso,
  };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const { data: merchant } = user
    ? await supabase
        .from("merchants")
        .select(
          "id, payout_auto, last_auto_payout_at, payout_method, payout_details, is_frozen"
        )
        .eq("user_id", user.id)
        .maybeSingle()
    : { data: null };

  const [
    walletSummary,
    pageData,
    payoutHistory,
    deliveryRows,
    coligoPay,
    platformSettings,
  ] = await Promise.all([
    getWalletSummary(),
    getWalletEntriesPage(page, PAGE_SIZE, entryFilters),
    getPayoutHistory(),
    // Avances COD que ses livreurs lui ont payées en main propre au retrait.
    merchant
      ? supabase
          .from("delivery_ledger")
          .select("amount_da")
          .eq("merchant_id", merchant.id)
          .eq("type", "driver_owes_merchant")
      : Promise.resolve({ data: [] }),
    getMyWalletState(),
    getPlatformSettings(),
  ]);

  const owedByDriversDa = (
    (deliveryRows.data ?? []) as { amount_da: number }[]
  ).reduce((s, r) => s + r.amount_da, 0);

  const reserved = reservedAmount(payoutHistory);
  const balance = walletSummary.balance;
  const summary: FinancesSummary = {
    balance,
    available: Math.max(0, balance - reserved),
    reserved,
  };

  // Versements affichés = ceux de la période sélectionnée (un versement payé
  // « vit » à sa date de paiement, une demande en cours à sa date de demande).
  const payoutsInPeriod = payoutHistory.filter((p) => {
    const d = p.status === "paid" ? (p.periodTo ?? p.created_at) : p.created_at;
    return d >= period.fromIso && d < period.toIso;
  });

  const pageCount = Math.max(1, Math.ceil(pageData.total / PAGE_SIZE));

  // Prochain versement automatique (cadence + date concrète) pour le héro.
  const mp = merchant as {
    payout_auto?: "none" | "weekly" | "monthly";
    last_auto_payout_at?: string | null;
    payout_method?: string | null;
    payout_details?: string | null;
    is_frozen?: boolean | null;
  } | null;
  const nextPayout: NextPayout = computeNextPayout({
    payoutAuto: mp?.payout_auto ?? "none",
    lastAutoPayoutAt: mp?.last_auto_payout_at ?? null,
    method: mp?.payout_method ?? null,
    details: mp?.payout_details ?? null,
    isFrozen: mp?.is_frozen ?? false,
    available: summary.available,
  });

  // Politique de dette espèces (mig 0269) : dette = part négative du solde.
  const cashDebt: CashDebtStatus = cashDebtStatus(
    Math.max(0, -balance),
    platformSettings?.max_debt_da ?? 0
  );

  const exportQs = new URLSearchParams({
    from: period.fromIso,
    to: period.toIso,
  }).toString();

  return (
    <>
      {/* Hub Argent commerçant : Finances · Stats · Coligo Pay. */}
      <div className="mx-auto max-w-[1100px] px-4 pt-4 lg:px-8 lg:pt-6">
        <MerchantMoneyTabs />
      </div>
      <FinancesView
        entries={pageData.entries}
        historyFilters={{
          type: sp.type ?? "",
          period: period.key,
          from: sp.from ?? "",
          to: sp.to ?? "",
          active: Boolean(sp.type) || period.key !== "month",
        }}
        payouts={payoutsInPeriod}
        hasAnyPayout={payoutHistory.length > 0}
        summary={summary}
        page={page}
        pageCount={pageCount}
        total={pageData.total}
        coligoPayBalance={coligoPay?.effectiveBalanceDa ?? balance}
        nextPayout={nextPayout}
        cashDebt={cashDebt}
        owedByDriversDa={owedByDriversDa}
        exportQs={exportQs}
      />
    </>
  );
}

export type FinancesSummary = {
  balance: number;
  available: number;
  reserved: number;
};
