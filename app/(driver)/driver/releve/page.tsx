import { redirect } from "next/navigation";
import { getCurrentDriver } from "@/lib/auth/driver";
import { createClient } from "@/lib/supabase/server";
import { DriverShell } from "@/components/driver/driver-shell";
import {
  SettlementView,
  type SettlementData,
} from "@/components/driver/releve/settlement-view";

export const dynamic = "force-dynamic";

type LedgerRow = {
  order_id: string | null;
  type: string;
  amount_da: number;
};
type OrderSnap = {
  id: string;
  payment_method: "cash" | "online";
  commission_da: number | null;
  service_fee_da: number | null;
  driver_fee_da: number | null;
};

/**
 * Relevé · règlement du livreur. Agrège en LIVE les écritures `delivery_ledger`
 * NON réglées (settled_at IS NULL) + les snapshots `orders` pour le détail
 * (commission / frais de service / part Coligo). Le sens du solde est calculé
 * exactement comme la RPC `generate_driver_statements` (cf. docs).
 */
export default async function DriverRelevePage() {
  const supabase = await createClient();
  const driver = await getCurrentDriver();
  if (!driver) redirect("/driver/login");

  // Écritures non réglées + config + profil versement (en parallèle).
  const [ledgerRes, profileRes, settingsRes] = await Promise.all([
    supabase
      .from("delivery_ledger")
      .select("order_id, type, amount_da, settled_at")
      .eq("driver_id", driver.id)
      .is("settled_at", null),
    supabase
      .from("drivers")
      .select("payout_method, payout_details")
      .eq("id", driver.id)
      .single(),
    supabase
      .from("platform_settings")
      .select("driver_fee_rate, driver_settlement_cycle")
      .eq("id", true)
      .single(),
  ]);

  const ledger = (ledgerRes.data ?? []) as LedgerRow[];
  const orderIds = Array.from(
    new Set(ledger.map((l) => l.order_id).filter((x): x is string => !!x))
  );

  let orders: OrderSnap[] = [];
  if (orderIds.length > 0) {
    const { data } = await supabase
      .from("orders")
      .select(
        "id, payment_method, commission_da, service_fee_da, driver_fee_da"
      )
      .in("id", orderIds);
    orders = (data ?? []) as OrderSnap[];
  }
  const orderById = new Map(orders.map((o) => [o.id, o]));

  // Agrégation (miroir de generate_driver_statements).
  let grossDriver = 0;
  let toReverse = 0;
  let toReceive = 0;
  let commission = 0;
  let serviceFee = 0;
  let driverFee = 0;
  const deliveryOrderIds = new Set<string>();

  for (const e of ledger) {
    const o = e.order_id ? orderById.get(e.order_id) : undefined;
    if (e.type === "driver_payout") {
      grossDriver += e.amount_da;
      if (e.order_id) deliveryOrderIds.add(e.order_id);
      if (o?.payment_method === "online") toReceive += e.amount_da;
    } else if (e.type === "driver_owes_platform") {
      toReverse += e.amount_da;
      commission += o?.commission_da ?? 0;
      serviceFee += o?.service_fee_da ?? 0;
      driverFee += o?.driver_fee_da ?? 0;
    }
  }

  const netDa = toReceive - toReverse;
  const direction: SettlementData["direction"] =
    netDa > 0 ? "receive" : netDa < 0 ? "reverse" : "settled";

  const profile = (profileRes.data ?? {}) as {
    payout_method?: string | null;
    payout_details?: string | null;
  };
  const settings = (settingsRes.data ?? {}) as {
    driver_fee_rate?: number;
    driver_settlement_cycle?: string;
  };
  const cycle =
    settings.driver_settlement_cycle === "monthly" ? "mensuel" : "hebdo";

  const data: SettlementData = {
    periodLabel: "période en cours",
    deliveriesCount: deliveryOrderIds.size,
    grossDriverDa: grossDriver,
    commissionDa: commission,
    serviceFeeDa: serviceFee,
    driverFeeDa: driverFee,
    toReverseDa: toReverse,
    toReceiveDa: toReceive,
    netDa,
    direction,
    driverFeeRatePct: Math.round((settings.driver_fee_rate ?? 0.08) * 100),
    method: profile.payout_method ?? null,
    details: profile.payout_details ?? null,
    dueLabel:
      direction === "reverse"
        ? `Règlement ${cycle} · part plateforme encaissée en espèces`
        : direction === "receive"
          ? `Versement au prochain cycle ${cycle}`
          : null,
  };

  return (
    <DriverShell driverFirstName={driver.full_name.split(" ")[0]}>
      <SettlementView data={data} />
    </DriverShell>
  );
}
