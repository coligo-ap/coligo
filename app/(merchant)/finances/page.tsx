import { getPayoutRequests, getWalletEntries } from "@/lib/data/wallet";
import {
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

  const balance = walletBalance(entries);
  const reserved = reservedAmount(requests);

  const summary: FinancesSummary = {
    balance,
    // Solde négatif = dette de commissions (mode cash) à régler à Coligo.
    debt: balance < 0 ? -balance : 0,
    // On ne peut verser que le net positif, moins les demandes en cours.
    available: Math.max(0, balance - reserved),
    reserved,
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
  debt: number;
  available: number;
  reserved: number;
  totalSales: number;
  totalCommission: number;
  totalPaidOut: number;
};
