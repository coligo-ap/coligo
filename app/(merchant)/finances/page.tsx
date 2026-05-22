import { getPayoutRequests, getWalletEntries } from "@/lib/data/wallet";
import {
  availableBalance,
  reservedAmount,
  sumByType,
  walletBalance,
} from "@/lib/finances/balance";
import { FinancesView } from "@/components/merchant/finances/finances-view";

export const dynamic = "force-dynamic";

export default async function FinancesPage() {
  const [entries, requests] = await Promise.all([
    getWalletEntries(),
    getPayoutRequests(),
  ]);

  const summary = {
    balance: walletBalance(entries),
    available: availableBalance(entries, requests),
    reserved: reservedAmount(requests),
    totalSales: sumByType(entries, "sale"),
    totalCommission: sumByType(entries, "commission"), // négatif
    totalPaidOut: sumByType(entries, "payout"), // négatif
  };

  return (
    <FinancesView entries={entries} requests={requests} summary={summary} />
  );
}

export type FinancesSummary = {
  balance: number;
  available: number;
  reserved: number;
  totalSales: number;
  totalCommission: number;
  totalPaidOut: number;
};
