import { redirect } from "next/navigation";
import { getCurrentDriver } from "@/lib/auth/driver";
import { createClient } from "@/lib/supabase/server";
import { DriverShell } from "@/components/driver/driver-shell";
import {
  getDriverFirstActivityMonth,
  getDriverSettlement,
  parseSettlementPeriod,
} from "@/lib/driver/settlement-data";
import { SettlementView } from "@/components/driver/releve/settlement-view";
import { RelevePeriodPicker } from "@/components/driver/releve/period-picker";

export const dynamic = "force-dynamic";

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
 * Relevé · règlement du livreur. Les données sont calculées par
 * `getDriverSettlement` (lib/driver/settlement-data.ts) — SOURCE UNIQUE
 * partagée avec l'export PDF /api/pdf/releve.
 */
export default async function DriverRelevePage({
  searchParams,
}: {
  searchParams: Promise<{ month?: string; from?: string; to?: string }>;
}) {
  const params = await searchParams;
  const supabase = await createClient();
  const driver = await getCurrentDriver();
  if (!driver) redirect("/driver/login");

  // Période demandée (?month= / ?from=&to=) — même interprétation que le PDF.
  const period = parseSettlementPeriod(params);

  // Relevé (source partagée) + borne du sélecteur + réclamations no-show.
  const [data, firstMonth, claimsRes] = await Promise.all([
    getDriverSettlement(driver.id, period),
    getDriverFirstActivityMonth(driver.id),
    supabase
      .from("driver_refund_claims")
      .select(
        "id, order_id, advance_da, status, goods_decision, admin_note, created_at"
      )
      .eq("driver_id", driver.id)
      .order("created_at", { ascending: false })
      .limit(10),
  ]);

  // Le PDF reprend EXACTEMENT la période affichée.
  const pdfQuery = params.month
    ? `?month=${params.month}`
    : params.from && params.to
      ? `?from=${params.from}&to=${params.to}`
      : "";

  const claims = (claimsRes.data ?? []) as Claim[];

  return (
    <DriverShell driverFirstName={driver.full_name.split(" ")[0]}>
      <SettlementView
        data={data}
        pdfHref={`/api/pdf/releve${pdfQuery}`}
        periodPicker={
          <RelevePeriodPicker
            firstMonth={firstMonth}
            selectedMonth={params.month ?? null}
            customFrom={params.from ?? null}
            customTo={params.to ?? null}
          />
        }
      />
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
