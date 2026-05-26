import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft, Wallet } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { getCurrentDriver } from "@/lib/auth/driver";
import { formatDA } from "@/lib/utils";

export const dynamic = "force-dynamic";

type Entry = {
  id: string;
  type:
    | "driver_payout"
    | "driver_cash_collected"
    | "driver_owes_merchant"
    | "driver_owes_platform"
    | "adjustment";
  amount_da: number;
  note: string | null;
  created_at: string;
  merchant_id: string | null;
};

export default async function DriverGainsPage() {
  const supabase = await createClient();
  const driver = await getCurrentDriver();
  if (!driver) redirect("/driver/login");

  const { data: rows } = await supabase
    .from("delivery_ledger")
    .select("id, type, amount_da, note, created_at, merchant_id")
    .eq("driver_id", driver.id)
    .order("created_at", { ascending: false })
    .limit(200);

  const entries = (rows ?? []) as Entry[];

  // KPIs
  const sumByType = (t: Entry["type"]) =>
    entries.filter((e) => e.type === t).reduce((s, e) => s + e.amount_da, 0);

  const totalEarnings = sumByType("driver_payout");
  const totalCashCollected = sumByType("driver_cash_collected");
  const owesMerchant = sumByType("driver_owes_merchant");
  const adjustments = sumByType("adjustment");

  // Net "à reverser" = encaissé cash - dû livreur (payout)
  const netCashToHandBack = Math.max(
    0,
    totalCashCollected - totalEarnings + adjustments
  );

  return (
    <div className="space-y-5">
      <Link
        href="/driver"
        className="text-muted inline-flex items-center gap-1 text-sm"
      >
        <ArrowLeft className="size-4" />
        Accueil
      </Link>
      <header className="flex items-center gap-2">
        <Wallet className="size-6" />
        <h1 className="text-2xl font-bold tracking-tight">Mes gains</h1>
      </header>

      <div className="grid grid-cols-2 gap-3">
        <Kpi label="Total gagné" value={totalEarnings} tone="green" />
        <Kpi label="Cash encaissé" value={totalCashCollected} tone="blue" />
        <Kpi label="Dû au commerçant" value={owesMerchant} tone="amber" />
        <Kpi label="À reverser net" value={netCashToHandBack} tone="rose" />
      </div>

      <section className="border-border bg-surface rounded-[14px] border p-4">
        <h2 className="mb-3 text-sm font-semibold">Historique récent</h2>
        {entries.length === 0 ? (
          <p className="text-muted text-sm">
            Aucun mouvement pour l&apos;instant.
          </p>
        ) : (
          <ul className="divide-border divide-y">
            {entries.slice(0, 50).map((e) => (
              <li key={e.id} className="flex items-center gap-3 py-2 text-sm">
                <span className="min-w-0 flex-1">
                  <span className="block truncate font-medium">
                    {typeLabel(e.type)}
                  </span>
                  <span className="text-subtle text-xs tabular-nums">
                    {new Date(e.created_at).toLocaleString("fr-FR")}
                  </span>
                </span>
                <span
                  className={
                    "font-semibold tabular-nums " +
                    (e.type === "driver_payout"
                      ? "text-success-700"
                      : e.type === "driver_owes_merchant" ||
                          e.type === "driver_owes_platform"
                        ? "text-warning-700"
                        : "text-muted")
                  }
                >
                  {formatDA(e.amount_da)}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

function Kpi({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "green" | "blue" | "amber" | "rose";
}) {
  const colors: Record<typeof tone, string> = {
    green: "bg-success-50 text-success-700",
    blue: "bg-primary-50 text-primary-700",
    amber: "bg-warning-50 text-warning-700",
    rose: "bg-danger-50 text-danger-700",
  };
  return (
    <div className={"rounded-[12px] p-3 " + colors[tone]}>
      <p className="text-xs font-medium opacity-70">{label}</p>
      <p className="mt-0.5 text-lg font-bold tabular-nums">{formatDA(value)}</p>
    </div>
  );
}

function typeLabel(t: Entry["type"]): string {
  switch (t) {
    case "driver_payout":
      return "Rémunération livraison";
    case "driver_cash_collected":
      return "Cash encaissé";
    case "driver_owes_merchant":
      return "Dû au commerçant";
    case "driver_owes_platform":
      return "Dû à la plateforme";
    case "adjustment":
      return "Ajustement";
  }
}
