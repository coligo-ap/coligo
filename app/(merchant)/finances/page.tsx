import {
  getAdjustmentEntries,
  getPayoutRequests,
  getWalletEntriesPage,
  getWalletSummary,
} from "@/lib/data/wallet";
import { getMyWalletState } from "@/app/wallet/recharge-actions";
import { getInvoiceMonths } from "@/lib/data/invoices";
import { reservedAmount } from "@/lib/finances/balance";
import { computeNextPayout, type NextPayout } from "@/lib/finances/next-payout";
import { FinancesView } from "@/components/merchant/finances/finances-view";
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
  searchParams: Promise<{ page?: string }>;
}) {
  const { page: pageParam } = await searchParams;
  const page = parsePage(pageParam);

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
    requests,
    deliveryRows,
    ordersDelivery,
    invoiceMonths,
    coligoPay,
    adjustments,
  ] = await Promise.all([
    getWalletSummary(),
    getWalletEntriesPage(page, PAGE_SIZE),
    getPayoutRequests(),
    // Delivery_ledger : ce que ses livreurs lui doivent (cash produits)
    // OU ce qu'il leur paie (rare au MVP, on garde minimal).
    merchant
      ? supabase
          .from("delivery_ledger")
          .select("type, amount_da")
          .eq("merchant_id", merchant.id)
      : Promise.resolve({ data: [] }),
    // Total des frais de livraison sur ses commandes complétées.
    merchant
      ? supabase
          .from("orders")
          .select("delivery_fee_da, payment_method, status")
          .eq("merchant_id", merchant.id)
          .eq("fulfillment_type", "delivery")
      : Promise.resolve({ data: [] }),
    getInvoiceMonths(),
    getMyWalletState(),
    getAdjustmentEntries(),
  ]);

  type DeliveryRow = { type: string; amount_da: number };
  type OrderDeliveryRow = {
    delivery_fee_da: number | null;
    payment_method: "cash" | "online";
    status: string;
  };
  const dlRows = (deliveryRows.data ?? []) as DeliveryRow[];
  const ordRows = (ordersDelivery.data ?? []) as OrderDeliveryRow[];

  const deliveryStats = {
    totalDeliveryOrders: ordRows.length,
    completedDeliveryOrders: ordRows.filter((o) => o.status === "completed")
      .length,
    cashDeliveryFeesDa: ordRows
      .filter((o) => o.payment_method === "cash" && o.status === "completed")
      .reduce((s, o) => s + (o.delivery_fee_da ?? 0), 0),
    onlineDeliveryFeesDa: ordRows
      .filter((o) => o.payment_method === "online" && o.status === "completed")
      .reduce((s, o) => s + (o.delivery_fee_da ?? 0), 0),
    owedByDriversDa: dlRows
      .filter((r) => r.type === "driver_owes_merchant")
      .reduce((s, r) => s + r.amount_da, 0),
  };

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
    coligoPayCollected: walletSummary.coligoPayCollected,
    onlineCollected: walletSummary.onlineCollected,
    deliveryRevenue: walletSummary.deliveryRevenue,
    tourDeliveryCommission: walletSummary.tourDeliveryCommission,
    walletRedemption: walletSummary.walletRedemption,
    adjustments: walletSummary.adjustments,
  };

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

  return (
    <FinancesView
      entries={pageData.entries}
      requests={requests}
      summary={summary}
      deliveryStats={deliveryStats}
      invoiceMonths={invoiceMonths}
      page={page}
      pageCount={pageCount}
      total={pageData.total}
      coligoPayBalance={coligoPay?.effectiveBalanceDa ?? balance}
      nextPayout={nextPayout}
      adjustments={adjustments}
    />
  );
}

export type DeliveryStats = {
  totalDeliveryOrders: number;
  completedDeliveryOrders: number;
  cashDeliveryFeesDa: number;
  onlineDeliveryFeesDa: number;
  owedByDriversDa: number;
};

export type FinancesSummary = {
  balance: number;
  debt: number;
  available: number;
  reserved: number;
  totalSales: number;
  totalCommission: number;
  totalServiceFeesOwed: number;
  totalPaidOut: number;
  coligoPayCollected: number;
  onlineCollected: number;
  deliveryRevenue: number;
  tourDeliveryCommission: number;
  walletRedemption: number;
  adjustments: number;
};
