import Link from "next/link";
import {
  ArrowDownRight,
  ArrowUpRight,
  BarChart3,
  ShoppingBag,
  TrendingUp,
  Wallet,
  XCircle,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { RevenueChart } from "@/components/merchant/stats/revenue-chart";
import { Pagination } from "@/components/ui/pagination";
import { ORDER_STATUS_META, type OrderStatus } from "@/lib/types";
import { cn, formatDA } from "@/lib/utils";
import {
  STATS_PERIODS,
  buildBuckets,
  bucketIndex,
  parsePeriod,
  periodConfig,
  variationPct,
  type StatsPeriod,
} from "@/lib/stats";

const TOP_PAGE_SIZE = 10;

export const dynamic = "force-dynamic";

type OrderRow = {
  id: string;
  status: OrderStatus;
  total_da: number;
  created_at: string;
};
type ItemRow = {
  product_name: string;
  quantity: number;
  line_total_da: number;
};

export default async function StatsPage({
  searchParams,
}: {
  searchParams: Promise<{ period?: string; topPage?: string }>;
}) {
  const { period: periodParam, topPage: topPageParam } = await searchParams;
  const period = parsePeriod(periodParam);
  const cfg = periodConfig(period);
  const topPage = (() => {
    const n = Number(topPageParam);
    return Number.isFinite(n) && n >= 1 ? Math.floor(n) : 1;
  })();

  const supabase = await createClient();

  // 1) Commandes depuis le début de la période PRÉCÉDENTE (pour les variations).
  //    Limité à la période -> évite de charger tout l'historique. RLS = ce
  //    commerçant uniquement.
  const { data: ordersData } = await supabase
    .from("orders")
    .select("id, status, total_da, created_at")
    .gte("created_at", cfg.prevStart.toISOString())
    .lte("created_at", cfg.end.toISOString())
    .limit(5000);

  const orders = (ordersData ?? []) as OrderRow[];

  const inCurrent = (d: Date) => d >= cfg.start && d <= cfg.end;
  const inPrevious = (d: Date) => d >= cfg.prevStart && d < cfg.start;

  let caCur = 0,
    caPrev = 0,
    nbCur = 0,
    nbPrev = 0,
    totalCur = 0,
    cancelledCur = 0;
  const statusCounts: Record<OrderStatus, number> = {
    pending: 0,
    accepted: 0,
    preparing: 0,
    ready: 0,
    completed: 0,
    cancelled: 0,
  };
  const buckets = buildBuckets(cfg);
  const completedIds: string[] = [];

  for (const o of orders) {
    const d = new Date(o.created_at);
    const cur = inCurrent(d);
    if (cur) {
      totalCur++;
      statusCounts[o.status]++;
      if (o.status === "cancelled") cancelledCur++;
      if (o.status === "completed") {
        caCur += o.total_da;
        nbCur++;
        completedIds.push(o.id);
        const idx = bucketIndex(cfg, d);
        if (idx >= 0 && idx < buckets.length) buckets[idx].ca += o.total_da;
      }
    } else if (inPrevious(d) && o.status === "completed") {
      caPrev += o.total_da;
      nbPrev++;
    }
  }

  const basketCur = nbCur > 0 ? Math.round(caCur / nbCur) : 0;
  const basketPrev = nbPrev > 0 ? Math.round(caPrev / nbPrev) : 0;
  const cancelRate =
    totalCur > 0 ? Math.round((cancelledCur / totalCur) * 100) : 0;

  // 2) Top produits — items des commandes completed de la période.
  let items: ItemRow[] = [];
  if (completedIds.length > 0) {
    const { data: itemsData } = await supabase
      .from("order_items")
      .select("product_name, quantity, line_total_da")
      .in("order_id", completedIds)
      .limit(5000);
    items = (itemsData ?? []) as ItemRow[];
  }
  const productMap = new Map<string, { qty: number; ca: number }>();
  for (const it of items) {
    const e = productMap.get(it.product_name) ?? { qty: 0, ca: 0 };
    e.qty += Number(it.quantity);
    e.ca += it.line_total_da;
    productMap.set(it.product_name, e);
  }
  const allTopProducts = Array.from(productMap.entries())
    .map(([name, v]) => ({ name, ...v }))
    .sort((a, b) => b.ca - a.ca);
  const topTotal = allTopProducts.length;
  const topPageCount = Math.max(1, Math.ceil(topTotal / TOP_PAGE_SIZE));
  const topOffset = (topPage - 1) * TOP_PAGE_SIZE;
  const topProducts = allTopProducts.slice(
    topOffset,
    topOffset + TOP_PAGE_SIZE
  );

  const hasData = totalCur > 0;

  const topHrefFor = (p: number): string => {
    const params = new URLSearchParams();
    // « 7d » est le défaut de `parsePeriod` → on l'omet de l'URL.
    if (period !== "7d") params.set("period", period);
    if (p > 1) params.set("topPage", String(p));
    const qs = params.toString();
    return qs ? `/stats?${qs}#top` : "/stats#top";
  };

  return (
    <div className="mx-auto max-w-[1400px] p-4 lg:p-6 lg:px-8">
      {/* Header + sélecteur de période */}
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3 lg:mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">
            Statistiques
          </h1>
          <p className="text-muted mt-1 text-sm">Vos performances de vente.</p>
        </div>
        <nav className="bg-surface-3 inline-flex rounded-[12px] p-1">
          {STATS_PERIODS.map((p) => (
            <PeriodTab
              key={p.key}
              period={p.key}
              label={p.label}
              active={period}
            />
          ))}
        </nav>
      </header>

      {/* KPIs */}
      <section className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4 lg:gap-4">
        <Kpi
          label="Chiffre d'affaires"
          value={formatDA(caCur)}
          variation={variationPct(caCur, caPrev)}
          icon={TrendingUp}
        />
        <Kpi
          label="Commandes"
          value={String(nbCur)}
          variation={variationPct(nbCur, nbPrev)}
          icon={ShoppingBag}
        />
        <Kpi
          label="Panier moyen"
          value={formatDA(basketCur)}
          variation={variationPct(basketCur, basketPrev)}
          icon={Wallet}
        />
        <Kpi
          label="Taux d'annulation"
          value={`${cancelRate}%`}
          icon={XCircle}
          tone={cancelRate > 0 ? "danger" : undefined}
        />
      </section>

      {!hasData ? (
        <EmptyState />
      ) : (
        <div className="grid gap-4 lg:grid-cols-3 lg:gap-5">
          {/* Graphique CA */}
          <section className="border-border bg-surface rounded-[16px] border p-5 lg:col-span-2">
            <h2 className="mb-4 text-base font-semibold">
              Évolution du chiffre d&apos;affaires
            </h2>
            <RevenueChart data={buckets} />
          </section>

          {/* Répartition par statut */}
          <section className="border-border bg-surface rounded-[16px] border p-5">
            <h2 className="mb-4 text-base font-semibold">
              Répartition des commandes
            </h2>
            <StatusBreakdown counts={statusCounts} total={totalCur} />
          </section>

          {/* Top produits */}
          <section
            id="top"
            className="border-border bg-surface rounded-[16px] border p-5 lg:col-span-3"
          >
            <header className="mb-4 flex items-center justify-between gap-3">
              <h2 className="text-base font-semibold">Top produits</h2>
              {topTotal > 0 && (
                <span className="text-muted text-xs tabular-nums">
                  {topTotal} produit{topTotal > 1 ? "s" : ""}
                </span>
              )}
            </header>
            {topProducts.length === 0 ? (
              <p className="text-muted text-sm">
                Aucune vente finalisée sur la période.
              </p>
            ) : (
              <>
                <ol className="divide-border divide-y">
                  <li className="text-muted grid grid-cols-[2rem_1fr_auto_auto] items-center gap-3 pb-2 text-xs">
                    <span>#</span>
                    <span>Produit</span>
                    <span className="text-right">Qté</span>
                    <span className="w-24 text-right">CA</span>
                  </li>
                  {topProducts.map((p, i) => (
                    <li
                      key={p.name}
                      className="grid grid-cols-[2rem_1fr_auto_auto] items-center gap-3 py-2.5 text-sm"
                    >
                      <span className="text-primary-700 bg-primary-50 flex size-6 items-center justify-center rounded-full text-xs font-semibold tabular-nums">
                        {topOffset + i + 1}
                      </span>
                      <span className="truncate font-medium">{p.name}</span>
                      <span className="text-muted text-right tabular-nums">
                        {p.qty}
                      </span>
                      <span className="w-24 text-right font-semibold tabular-nums">
                        {formatDA(p.ca)}
                      </span>
                    </li>
                  ))}
                </ol>
                {topPageCount > 1 && (
                  <div className="border-border mt-4 border-t pt-3">
                    <Pagination
                      page={topPage}
                      pageCount={topPageCount}
                      hrefFor={topHrefFor}
                    />
                  </div>
                )}
              </>
            )}
          </section>
        </div>
      )}
    </div>
  );
}

function PeriodTab({
  period,
  label,
  active,
}: {
  period: StatsPeriod;
  label: string;
  active: StatsPeriod;
}) {
  const isActive = period === active;
  return (
    <Link
      href={`/stats?period=${period}`}
      className={cn(
        "rounded-[9px] px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors",
        isActive
          ? "text-primary-700 bg-white shadow-sm"
          : "text-muted hover:text-foreground"
      )}
    >
      {label}
    </Link>
  );
}

function Kpi({
  label,
  value,
  variation,
  icon: Icon,
  tone,
}: {
  label: string;
  value: string;
  variation?: number | null;
  icon: React.ComponentType<{ className?: string }>;
  tone?: "danger";
}) {
  return (
    <div className="border-border bg-surface rounded-[16px] border p-4 shadow-sm lg:p-5">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-muted text-xs font-medium">{label}</span>
        <Icon
          className={cn(
            "size-4",
            tone === "danger" ? "text-danger-500" : "text-primary-500"
          )}
        />
      </div>
      <div className="text-xl font-bold tracking-tight tabular-nums lg:text-2xl">
        {value}
      </div>
      {variation !== undefined && <Variation pct={variation} />}
    </div>
  );
}

function Variation({ pct }: { pct: number | null }) {
  if (pct === null) {
    return <p className="text-subtle mt-1 text-xs">— vs période précédente</p>;
  }
  const positive = pct >= 0;
  const Icon = positive ? ArrowUpRight : ArrowDownRight;
  return (
    <p
      className={cn(
        "mt-1 flex items-center gap-0.5 text-xs font-medium",
        positive ? "text-success-600" : "text-danger-600"
      )}
    >
      <Icon className="size-3.5" />
      {positive ? "+" : ""}
      {pct}% <span className="text-subtle font-normal">vs préc.</span>
    </p>
  );
}

function StatusBreakdown({
  counts,
  total,
}: {
  counts: Record<OrderStatus, number>;
  total: number;
}) {
  const order: OrderStatus[] = [
    "pending",
    "accepted",
    "preparing",
    "ready",
    "completed",
    "cancelled",
  ];
  const TONE: Record<OrderStatus, string> = {
    pending: "bg-warning-500",
    accepted: "bg-primary-400",
    preparing: "bg-primary-500",
    ready: "bg-success-500",
    completed: "bg-success-600",
    cancelled: "bg-danger-500",
  };
  return (
    <ul className="space-y-3">
      {order
        .filter((s) => counts[s] > 0)
        .map((s) => {
          const pct = total > 0 ? Math.round((counts[s] / total) * 100) : 0;
          return (
            <li key={s}>
              <div className="mb-1 flex items-center justify-between text-xs">
                <span className="font-medium">
                  {ORDER_STATUS_META[s].label}
                </span>
                <span className="text-muted tabular-nums">
                  {counts[s]} · {pct}%
                </span>
              </div>
              <div className="bg-surface-3 h-2 overflow-hidden rounded-full">
                <div
                  className={cn("h-full rounded-full", TONE[s])}
                  style={{ width: `${pct}%` }}
                />
              </div>
            </li>
          );
        })}
    </ul>
  );
}

function EmptyState() {
  return (
    <div className="border-border bg-surface flex flex-col items-center justify-center rounded-[16px] border border-dashed py-16 text-center">
      <div className="bg-primary-50 text-primary-600 mb-4 flex size-14 items-center justify-center rounded-2xl">
        <BarChart3 className="size-7" />
      </div>
      <h2 className="text-lg font-semibold">Aucune donnée sur cette période</h2>
      <p className="text-muted mt-1 max-w-sm text-sm">
        Dès que vous aurez des commandes, vos statistiques apparaîtront ici.
      </p>
    </div>
  );
}
