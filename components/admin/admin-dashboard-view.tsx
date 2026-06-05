import {
  Activity,
  Banknote,
  Bike,
  CreditCard,
  Gift,
  Receipt,
  Store,
  TrendingDown,
  TrendingUp,
  Users,
  Wallet,
} from "lucide-react";
import { formatDA } from "@/lib/utils";
import type { PlatformDashboard, AdminMerchantRow } from "@/lib/data/platform";

type Props = {
  stats: PlatformDashboard | null;
  merchants: AdminMerchantRow[];
};

export function AdminDashboardView({ stats, merchants }: Props) {
  if (!stats) {
    return (
      <div className="mx-auto max-w-2xl px-4 py-16 text-center">
        <p className="text-muted text-sm">
          Impossible de charger les statistiques (accès refusé ou base
          indisponible).
        </p>
      </div>
    );
  }

  const grossRevenue = stats.commission_income_da + stats.service_fee_income_da;
  const deliveryMargin = stats.delivery_fees_da - stats.driver_payouts_da;

  return (
    <div className="mx-auto max-w-6xl px-4 py-6 lg:px-6">
      <header className="mb-6">
        <h1 className="text-foreground text-2xl font-bold tracking-tight">
          Tableau de bord
        </h1>
        <p className="text-muted mt-1 text-sm">
          Vue d&apos;ensemble en temps réel — toutes enseignes, cumul depuis le
          lancement.
        </p>
      </header>

      {/* ── KPIs principaux ── */}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Kpi
          icon={TrendingUp}
          label="Bénéfice net plateforme"
          value={formatDA(stats.net_profit_da)}
          tone="profit"
          hint="Revenus − coûts (Chargily, cashback)"
          big
        />
        <Kpi
          icon={Banknote}
          label="Marge brute (revenus)"
          value={formatDA(grossRevenue)}
          hint="Commissions + frais de service"
        />
        <Kpi
          icon={Receipt}
          label="Chiffre d'affaires"
          value={formatDA(stats.gmv_da)}
          hint={`${stats.orders_completed} commandes livrées`}
        />
        <Kpi
          icon={CreditCard}
          label="Bénéfice net en ligne"
          value={formatDA(stats.online_net_da)}
          tone="profit"
          hint={`${stats.online_orders} commandes payées en ligne`}
        />
      </div>

      {/* ── Décomposition du bénéfice ── */}
      <Section title="Décomposition du bénéfice" icon={Activity}>
        <div className="divide-border divide-y">
          <Line
            label="Commission sur marchandises"
            value={stats.commission_income_da}
            positive
          />
          <Line
            label="Frais de service"
            value={stats.service_fee_income_da}
            positive
          />
          <Line
            label="Marge plateforme livraison"
            value={deliveryMargin}
            positive={deliveryMargin >= 0}
            muted
          />
          <Line
            label="Coût Chargily (paiement en ligne)"
            value={stats.chargily_fee_da}
          />
          <Line
            label="Coût cashback offert"
            value={stats.cashback_expense_da}
          />
          <div className="flex items-center justify-between pt-3">
            <span className="text-foreground text-sm font-bold">
              Bénéfice net
            </span>
            <span
              className={
                "text-base font-extrabold tabular-nums " +
                (stats.net_profit_da >= 0
                  ? "text-success-700"
                  : "text-danger-600")
              }
            >
              {formatDA(stats.net_profit_da)}
            </span>
          </div>
        </div>
      </Section>

      {/* ── Commerçants ── */}
      <Section title="Commerçants" icon={Store}>
        <div className="grid grid-cols-3 gap-3">
          <Stat icon={Users} label="Inscrits" value={stats.merchants_total} />
          <Stat icon={Store} label="Actifs" value={stats.merchants_active} />
          <Stat
            icon={TrendingUp}
            label="Ayant vendu"
            value={stats.merchants_sold}
            tone="profit"
          />
        </div>
      </Section>

      {/* ── Livraison ── */}
      <Section title="Livraison" icon={Bike}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <Stat
            icon={Bike}
            label="Commandes livrées"
            value={stats.delivery_orders}
          />
          <MoneyStat
            label="Frais de livraison encaissés"
            value={stats.delivery_fees_da}
          />
          <MoneyStat
            label="Reversé aux livreurs"
            value={stats.driver_payouts_da}
          />
          <MoneyStat
            label="Marge plateforme"
            value={deliveryMargin}
            tone={deliveryMargin >= 0 ? "profit" : "loss"}
          />
        </div>
      </Section>

      {/* ── Cashback & Coligo Pay ── */}
      <Section title="Cashback & Coligo Pay" icon={Gift}>
        <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
          <MoneyStat
            label="Cashback offert (gagné)"
            value={stats.cashback_earned_da}
          />
          <MoneyStat
            label="Cashback consommé"
            value={stats.cashback_spent_da}
          />
          <MoneyStat
            label="Cashback en circulation"
            value={stats.cashback_outstanding_da}
            tone="loss"
            hint="Non encore consommé (passif)"
          />
          <MoneyStat
            label="Coligo Pay en circulation"
            value={stats.topup_outstanding_da}
            icon={Wallet}
            hint="Solde réel client à honorer"
          />
        </div>
      </Section>

      {/* ── Détail par commerçant ── */}
      <Section title="Détail par commerçant" icon={Store}>
        <div className="overflow-x-auto">
          <table className="w-full min-w-[640px] text-sm">
            <thead>
              <tr className="text-muted border-border border-b text-left text-xs">
                <th className="px-2 py-2 font-semibold">Commerçant</th>
                <th className="px-2 py-2 text-right font-semibold">Cmd</th>
                <th className="px-2 py-2 text-right font-semibold">CA</th>
                <th className="px-2 py-2 text-right font-semibold">
                  Commission
                </th>
                <th className="px-2 py-2 text-right font-semibold">Solde</th>
              </tr>
            </thead>
            <tbody className="divide-border divide-y">
              {merchants.map((m) => (
                <tr key={m.id}>
                  <td className="px-2 py-2.5">
                    <div className="flex items-center gap-2">
                      <span className="text-foreground font-medium">
                        {m.name}
                      </span>
                      {m.is_frozen && (
                        <span className="bg-danger-100 text-danger-700 rounded-full px-1.5 py-0.5 text-[10px] font-bold">
                          gelé
                        </span>
                      )}
                      {!m.is_active && (
                        <span className="bg-surface-2 text-muted rounded-full px-1.5 py-0.5 text-[10px] font-bold">
                          inactif
                        </span>
                      )}
                    </div>
                    {m.city && (
                      <span className="text-muted text-xs">{m.city}</span>
                    )}
                  </td>
                  <td className="px-2 py-2.5 text-right tabular-nums">
                    {m.completed_orders}
                  </td>
                  <td className="px-2 py-2.5 text-right font-semibold tabular-nums">
                    {formatDA(m.gmv_da)}
                  </td>
                  <td className="text-success-700 px-2 py-2.5 text-right tabular-nums">
                    {formatDA(m.commission_da)}
                  </td>
                  <td
                    className={
                      "px-2 py-2.5 text-right font-medium tabular-nums " +
                      (m.balance_da < 0 ? "text-danger-600" : "text-foreground")
                    }
                  >
                    {formatDA(m.balance_da)}
                  </td>
                </tr>
              ))}
              {merchants.length === 0 && (
                <tr>
                  <td
                    colSpan={5}
                    className="text-muted py-6 text-center text-sm"
                  >
                    Aucun commerçant.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <p className="text-subtle mt-2 text-xs">
          Solde négatif = commissions dues à la plateforme (encaissées en
          espèces par le commerçant).
        </p>
      </Section>
    </div>
  );
}

// ── Sous-composants ──

function Section({
  title,
  icon: Icon,
  children,
}: {
  title: string;
  icon: React.ComponentType<{ className?: string }>;
  children: React.ReactNode;
}) {
  return (
    <section className="border-border bg-surface mt-4 rounded-[16px] border p-4 lg:p-5">
      <h2 className="text-foreground mb-3 flex items-center gap-2 text-sm font-bold">
        <Icon className="text-primary-600 size-4" />
        {title}
      </h2>
      {children}
    </section>
  );
}

function Kpi({
  icon: Icon,
  label,
  value,
  hint,
  tone,
  big,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: string;
  hint?: string;
  tone?: "profit";
  big?: boolean;
}) {
  return (
    <div
      className={
        "rounded-[16px] border p-4 " +
        (tone === "profit"
          ? "border-success-200 bg-success-50"
          : "border-border bg-surface")
      }
    >
      <div className="text-muted flex items-center gap-1.5 text-[11px] font-semibold tracking-wide uppercase">
        <Icon className="size-3.5" />
        {label}
      </div>
      <div
        className={
          "mt-1.5 font-extrabold tabular-nums " +
          (big ? "text-2xl" : "text-xl") +
          (tone === "profit" ? " text-success-800" : " text-foreground")
        }
      >
        {value}
      </div>
      {hint && <div className="text-subtle mt-0.5 text-[11px]">{hint}</div>}
    </div>
  );
}

function Stat({
  icon: Icon,
  label,
  value,
  tone,
}: {
  icon: React.ComponentType<{ className?: string }>;
  label: string;
  value: number;
  tone?: "profit";
}) {
  return (
    <div className="border-border bg-surface-2/50 rounded-[12px] border p-3">
      <div className="text-muted flex items-center gap-1.5 text-[11px] font-semibold">
        <Icon className="size-3.5" />
        {label}
      </div>
      <div
        className={
          "mt-1 text-xl font-extrabold tabular-nums " +
          (tone === "profit" ? "text-success-700" : "text-foreground")
        }
      >
        {value}
      </div>
    </div>
  );
}

function MoneyStat({
  label,
  value,
  hint,
  tone,
  icon: Icon,
}: {
  label: string;
  value: number;
  hint?: string;
  tone?: "profit" | "loss";
  icon?: React.ComponentType<{ className?: string }>;
}) {
  return (
    <div className="border-border bg-surface-2/50 rounded-[12px] border p-3">
      <div className="text-muted flex items-center gap-1.5 text-[11px] font-semibold">
        {Icon && <Icon className="size-3.5" />}
        {label}
      </div>
      <div
        className={
          "mt-1 text-lg font-bold tabular-nums " +
          (tone === "profit"
            ? "text-success-700"
            : tone === "loss"
              ? "text-danger-600"
              : "text-foreground")
        }
      >
        {formatDA(value)}
      </div>
      {hint && <div className="text-subtle mt-0.5 text-[11px]">{hint}</div>}
    </div>
  );
}

function Line({
  label,
  value,
  positive,
  muted,
}: {
  label: string;
  value: number;
  positive?: boolean;
  muted?: boolean;
}) {
  // Coûts stockés en négatif dans le ledger → on affiche le signe réel.
  const isCost = value < 0;
  return (
    <div className="flex items-center justify-between py-2.5">
      <span className="text-muted inline-flex items-center gap-1.5 text-sm">
        {isCost ? (
          <TrendingDown className="text-danger-500 size-3.5" />
        ) : (
          <TrendingUp
            className={
              muted ? "text-subtle size-3.5" : "text-success-500 size-3.5"
            }
          />
        )}
        {label}
      </span>
      <span
        className={
          "text-sm font-semibold tabular-nums " +
          (isCost
            ? "text-danger-600"
            : positive
              ? "text-success-700"
              : "text-foreground")
        }
      >
        {formatDA(value)}
      </span>
    </div>
  );
}
