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
  delivery_failed_at: string | null;
};
type Claim = {
  id: string;
  order_id: string;
  advance_da: number;
  status: "pending" | "approved" | "rejected";
  goods_decision: "return_to_merchant" | "driver_keeps" | "give_away" | null;
  admin_note: string | null;
  created_at: string;
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

  // Écritures non réglées + config + profil versement + réclamations no-show.
  const [ledgerRes, profileRes, settingsRes, claimsRes] = await Promise.all([
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
    supabase
      .from("driver_refund_claims")
      .select(
        "id, order_id, advance_da, status, goods_decision, admin_note, created_at"
      )
      .eq("driver_id", driver.id)
      .order("created_at", { ascending: false })
      .limit(10),
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
        "id, payment_method, commission_da, service_fee_da, driver_fee_da, delivery_failed_at"
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
      // « À recevoir » : prépayé OU no-show (la plateforme doit au livreur).
      if (o?.payment_method === "online" || o?.delivery_failed_at) {
        toReceive += e.amount_da;
      }
    } else if (e.type === "driver_advance_refund") {
      // Avance no-show remboursée par la plateforme (validée par le support).
      toReceive += e.amount_da;
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

  const claims = (claimsRes.data ?? []) as Claim[];

  return (
    <DriverShell driverFirstName={driver.full_name.split(" ")[0]}>
      <SettlementView data={data} />
      {claims.length > 0 && <ClaimsSection claims={claims} />}
    </DriverShell>
  );
}

/**
 * Réclamations d'avance no-show (mig 0160) : l'avance payée au commerçant au
 * pickup d'une commande COD finie en no-show n'est remboursée qu'après
 * validation du support, qui décide aussi du sort de la marchandise.
 */
function ClaimsSection({ claims }: { claims: Claim[] }) {
  return (
    <section className="mt-4 mb-6 rounded-[18px] border border-[var(--d-line)] bg-[var(--d-surface)] p-4">
      <h2 className="text-sm font-semibold text-[var(--d-ink)]">
        Avances no-show (validation support)
      </h2>
      <ul className="mt-2 space-y-3">
        {claims.map((c) => (
          <li key={c.id} className="text-sm">
            <div className="flex items-center justify-between gap-2">
              <span className="font-semibold tabular-nums">
                {c.advance_da.toLocaleString("fr-FR").replace(/ /g, " ")} DA
              </span>
              <ClaimBadge status={c.status} />
            </div>
            <p className="mt-0.5 text-xs text-[var(--d-muted)]">
              {claimMessage(c)}
            </p>
          </li>
        ))}
      </ul>
    </section>
  );
}

function ClaimBadge({ status }: { status: Claim["status"] }) {
  const map = {
    pending: ["En attente du support", "bg-amber-50 text-amber-700"],
    approved: ["Validée", "bg-emerald-50 text-emerald-700"],
    rejected: ["Refusée", "bg-rose-50 text-rose-700"],
  } as const;
  const [label, cls] = map[status];
  return (
    <span
      className={`rounded-full px-2 py-0.5 text-[11px] font-semibold ${cls}`}
    >
      {label}
    </span>
  );
}

function claimMessage(c: Claim): string {
  if (c.status === "pending") {
    return "Le support vérifie votre avance et décidera du sort de la commande (retour, garder ou donner).";
  }
  if (c.status === "rejected") {
    return c.admin_note
      ? `Refusée par le support : ${c.admin_note}`
      : "Refusée par le support — contactez l'aide si besoin.";
  }
  switch (c.goods_decision) {
    case "return_to_merchant":
      return "Retournez la commande au commerçant : il vous rend l'avance en main propre.";
    case "driver_keeps":
      return "Vous gardez la commande — l'avance est créditée sur votre relevé.";
    case "give_away":
      return "Commande à donner — l'avance est créditée sur votre relevé.";
    default:
      return "Validée par le support.";
  }
}
