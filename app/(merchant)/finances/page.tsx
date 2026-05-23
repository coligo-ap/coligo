import {
  getPayoutRequests,
  getWalletEntriesPage,
  getWalletSummary,
} from "@/lib/data/wallet";
import { reservedAmount } from "@/lib/finances/balance";
import { FinancesView } from "@/components/merchant/finances/finances-view";

export const dynamic = "force-dynamic";

const PAGE_SIZE = 10;

function parsePage(raw?: string): number {
  const n = Number(raw);
  return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
}

export default async function FinancesPage({
  searchParams,
}: {
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const page = parsePage(pageParam);

  const [walletSummary, pageData, requests] = await Promise.all([
    getWalletSummary(),
    getWalletEntriesPage(page, PAGE_SIZE),
    getPayoutRequests(),
  ]);

  const reserved = reservedAmount(requests);
  const balance = walletSummary.balance;

  const summary: FinancesSummary = {
    balance,
    debt: balance < 0 ? -balance : 0,
    available: Math.max(0, balance - reserved),
    reserved,
    totalSales: walletSummary.totalSales,
    totalCommission: walletSummary.totalCommission,
    totalServiceFeesOwed: walletSummary.totalServiceFeesOwed,
    totalPaidOut: walletSummary.totalPaidOut,
  };

  const pageCount = Math.max(1, Math.ceil(pageData.total / PAGE_SIZE));

  return (
    <FinancesView
      entries={pageData.entries}
      requests={requests}
      summary={summary}
      page={page}
      pageCount={pageCount}
      total={pageData.total}
    />
  );
}

export type FinancesSummary = {
  balance: number;
  debt: number;
  available: number;
  reserved: number;
  totalSales: number;
  totalCommission: number;
  totalServiceFeesOwed: number;
  totalPaidOut: number;
};
