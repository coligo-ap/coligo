import { redirect } from "next/navigation";
import {
  Banknote,
  CreditCard,
  Package,
  Receipt,
  Truck,
  Wallet,
} from "lucide-react";
import { createAdminClient } from "@/lib/supabase/admin";
import { isSuperAdmin } from "@/lib/auth/admin";
import { formatDA } from "@/lib/utils";
import { InfoHint } from "@/components/ui/info-hint";

export const dynamic = "force-dynamic";

type Entry = {
  type:
    | "driver_payout"
    | "driver_cash_collected"
    | "driver_owes_platform"
    | "driver_owes_merchant"
    | "driver_advance_refund"
    | "adjustment";
  amount_da: number;
};

type AuditRow = {
  id: string;
  admin_email: string | null;
  action: string;
  target_kind: string;
  target_id: string | null;
  note: string | null;
  created_at: string;
};

export default async function AdminDeliveryFinancesPage() {
  if (!(await isSuperAdmin())) redirect("/admin");
  const admin = createAdminClient();

  // 1. Vue d'ensemble du ledger livraison
  const { data: ledgerRows } = await admin
    .from("delivery_ledger")
    .select("type, amount_da");
  const entries = (ledgerRows ?? []) as Entry[];

  const sum = (t: Entry["type"]) =>
    entries.filter((e) => e.type === t).reduce((s, e) => s + e.amount_da, 0);

  const totalPayouts = sum("driver_payout");
  const cashCollected = sum("driver_cash_collected");
  const owesPlatform = sum("driver_owes_platform");
  const owesMerchant = sum("driver_owes_merchant");
  const adjustments = sum("adjustment");
  const advanceRefunds = sum("driver_advance_refund");

  // 2. Compteurs commandes livraison
  const { data: ordersAgg } = await admin
    .from("orders")
    .select("status, payment_method, delivery_fee_da")
    .eq("fulfillment_type", "delivery");
  type OrdRow = {
    status: string;
    payment_method: "cash" | "online";
    delivery_fee_da: number | null;
  };
  const ords = (ordersAgg ?? []) as OrdRow[];
  const totalOrders = ords.length;
  const completed = ords.filter((o) => o.status === "completed");
  const completedCount = completed.length;
  const cashCompleted = completed.filter((o) => o.payment_method === "cash");
  const onlineCompleted = completed.filter(
    (o) => o.payment_method === "online"
  );
  const totalDeliveryFees = completed.reduce(
    (s, o) => s + (o.delivery_fee_da ?? 0),
    0
  );

  // 3. Audit récent
  const { data: auditRows } = await admin
    .from("admin_audit_log")
    .select("id, admin_email, action, target_kind, target_id, note, created_at")
    .order("created_at", { ascending: false })
    .limit(50);
  const audit = (auditRows ?? []) as AuditRow[];

  return (
    <div className="mx-auto max-w-[1100px] p-4 lg:p-6">
      <header className="mb-5 flex items-center gap-2">
        <Wallet className="size-6" />
        <h1 className="text-2xl font-bold tracking-tight">Argent livraison</h1>
      </header>

      <section className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          icon={<Package className="size-4" />}
          label="Commandes livraison"
          value={String(totalOrders)}
          sub={`${completedCount} livrées`}
          tone="violet"
        />
        <Kpi
          icon={<Receipt className="size-4" />}
          label="Total frais livraison"
          value={formatDA(totalDeliveryFees)}
          sub="Commandes complétées"
          tone="blue"
        />
        <Kpi
          icon={<CreditCard className="size-4" />}
          label="Online (livrées)"
          value={String(onlineCompleted.length)}
          sub={`${formatDA(onlineCompleted.reduce((s, o) => s + (o.delivery_fee_da ?? 0), 0))} de frais`}
          tone="green"
        />
        <Kpi
          icon={<Banknote className="size-4" />}
          label="Cash (livrées)"
          value={String(cashCompleted.length)}
          sub={`${formatDA(cashCompleted.reduce((s, o) => s + (o.delivery_fee_da ?? 0), 0))} de frais`}
          tone="amber"
        />
      </section>

      <section className="border-border bg-surface mb-6 rounded-[14px] border p-5">
        <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
          <Truck className="size-4" />
          Ledger livreurs (cumul)
        </h2>
        <dl className="grid grid-cols-2 gap-3 text-sm lg:grid-cols-6">
          <LedgerCell
            label="Rémunérations livreurs"
            value={totalPayouts}
            hint="Total dû/versé aux livreurs pour leurs courses. Dans le modèle MVP, 100 % des frais de livraison reviennent au livreur."
            example="20 livraisons à 150 DA → 3000 DA de rémunérations."
          />
          <LedgerCell
            label="Cash encaissé livreurs"
            value={cashCollected}
            hint="Argent liquide collecté par les livreurs auprès des clients (commandes payées à la livraison / COD)."
            example="Le livreur encaisse 1200 DA en espèces → il en est le dépositaire jusqu'au reversement."
          />
          <LedgerCell
            label="Dû livreur → commerçant"
            value={owesMerchant}
            hint="Ce que les livreurs doivent reverser aux commerçants : le cash encaissé qui correspond aux produits."
            example="Cash COD 1200 DA dont 1000 DA de produits → 1000 DA dus au commerçant."
          />
          <LedgerCell
            label="Dû livreur → plateforme"
            value={owesPlatform}
            hint="Ce que les livreurs doivent à Coligo (commissions, avances à régulariser)."
            example="Commission/avances non encore réglées par le livreur."
          />
          <LedgerCell
            label="Avances no-show remboursées"
            value={advanceRefunds}
            hint="Avances rendues au livreur après validation par le support d'un « client absent » (no-show)."
            example="Le client ne se présente pas → après validation, l'avance du livreur lui est remboursée."
          />
          <LedgerCell
            label="Ajustements"
            value={adjustments}
            hint="Corrections manuelles passées par un admin (type « adjustment ») pour rectifier le ledger."
            example="+200 DA pour compenser une erreur de course."
          />
        </dl>
        <p className="text-subtle mt-3 text-xs">
          Modèle MVP : 100 % des <code>delivery_fee_da</code> vont au livreur.
          La marge plateforme côté livraison est nulle au démarrage — ajustable
          via type <code>adjustment</code>.
        </p>
      </section>

      <section className="border-border bg-surface rounded-[14px] border p-5">
        <h2 className="mb-3 flex items-center gap-2 text-base font-semibold">
          <Receipt className="size-4" />
          Audit admin récent
        </h2>
        {audit.length === 0 ? (
          <p className="text-muted text-sm">Aucune entrée d&apos;audit.</p>
        ) : (
          <ul className="divide-border divide-y text-sm">
            {audit.map((a) => (
              <li
                key={a.id}
                className="flex items-center gap-3 py-2 tabular-nums"
              >
                <span className="text-muted shrink-0 text-xs">
                  {new Date(a.created_at).toLocaleString("fr-FR")}
                </span>
                <span className="font-mono text-xs">{a.action}</span>
                <span className="text-muted text-xs">
                  {a.target_kind} · {a.target_id?.slice(0, 8) ?? "—"}
                </span>
                <span className="text-muted ml-auto truncate text-xs">
                  {a.admin_email ?? "—"} {a.note ? `· ${a.note}` : ""}
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
  icon,
  label,
  value,
  sub,
  tone,
}: {
  icon: React.ReactNode;
  label: string;
  value: string;
  sub: string;
  tone: "violet" | "blue" | "green" | "amber";
}) {
  const colors: Record<typeof tone, string> = {
    violet: "bg-violet-50 text-violet-700",
    blue: "bg-primary-50 text-primary-700",
    green: "bg-success-50 text-success-700",
    amber: "bg-warning-50 text-warning-700",
  };
  return (
    <div className={"rounded-[12px] p-3 " + colors[tone]}>
      <div className="flex items-center gap-1.5 text-xs font-medium opacity-80">
        {icon}
        {label}
      </div>
      <p className="mt-1 text-lg font-bold tabular-nums">{value}</p>
      <p className="text-xs opacity-70">{sub}</p>
    </div>
  );
}

function LedgerCell({
  label,
  value,
  hint,
  example,
}: {
  label: string;
  value: number;
  hint?: string;
  example?: string;
}) {
  return (
    <div>
      <dt className="text-muted flex items-center gap-1 text-xs">
        {label}
        {hint && <InfoHint title={label} text={hint} example={example} />}
      </dt>
      <dd className="text-base font-semibold tabular-nums">
        {formatDA(value)}
      </dd>
    </div>
  );
}
