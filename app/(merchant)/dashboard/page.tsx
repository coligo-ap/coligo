import { createClient } from "@/lib/supabase/server";
import { KpiCard } from "@/components/merchant/kpi-card";
import { KanbanBoard } from "@/components/merchant/kanban-board";
import { MobileOrderList } from "@/components/merchant/order-list-mobile";
import { Inbox, ShoppingBag, TrendingUp, Clock } from "lucide-react";
import { formatDA } from "@/lib/utils";
import type { OrderWithItems } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createClient();

  const { data: orders, error } = await supabase
    .from("orders")
    .select(
      `
      id, merchant_id, customer_name, customer_phone, status,
      total_da, pickup_code, pickup_slot_at, notes, created_at,
      order_items (
        id, order_id, product_name, unit_price_da, quantity, line_total_da
      )
    `
    )
    .order("created_at", { ascending: false })
    .limit(100);

  if (error) {
    return (
      <div className="p-4 lg:p-6">
        <div className="rounded-[10px] bg-rose-50 border border-rose-200 px-4 py-3 text-sm text-rose-800">
          Erreur de chargement : {error.message}
        </div>
      </div>
    );
  }

  const ordersList = (orders ?? []) as OrderWithItems[];

  // KPIs
  const pendingCount = ordersList.filter((o) => o.status === "pending").length;
  const inPrepCount = ordersList.filter(
    (o) => o.status === "accepted" || o.status === "preparing"
  ).length;

  const today = new Date();
  const todayOrders = ordersList.filter((o) => {
    const d = new Date(o.created_at);
    return (
      d.getDate() === today.getDate() &&
      d.getMonth() === today.getMonth() &&
      d.getFullYear() === today.getFullYear()
    );
  });
  const todayRevenue = todayOrders
    .filter((o) => o.status !== "cancelled")
    .reduce((sum, o) => sum + o.total_da, 0);

  return (
    <div className="p-4 lg:p-6 lg:px-8 max-w-[1600px] mx-auto">
      {/* Header */}
      <header className="mb-5 lg:mb-6 flex items-end justify-between gap-4">
        <div>
          <h1 className="text-2xl lg:text-3xl font-bold tracking-tight">
            Tableau de bord
          </h1>
          <p className="text-sm text-muted mt-1 flex items-center gap-2">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-green-500" />
              En ligne
            </span>
            <span>·</span>
            <span>Vos commandes en temps réel</span>
          </p>
        </div>
      </header>

      {/* KPIs */}
      <section className="grid grid-cols-2 lg:grid-cols-4 gap-3 lg:gap-4 mb-6 lg:mb-8">
        <KpiCard
          label="À confirmer"
          value={pendingCount}
          icon={Inbox}
          tone="amber"
        />
        <KpiCard
          label="En préparation"
          value={inPrepCount}
          icon={Clock}
          tone="teal"
        />
        <KpiCard
          label="Commandes du jour"
          value={todayOrders.length}
          icon={ShoppingBag}
          tone="green"
        />
        <KpiCard
          label="Revenu du jour"
          value={formatDA(todayRevenue)}
          icon={TrendingUp}
          tone="stone"
        />
      </section>

      {/* Desktop : Kanban */}
      <div className="hidden lg:block">
        <header className="flex items-center justify-between mb-4">
          <h2 className="text-base font-semibold">Commandes</h2>
          <span className="text-xs text-muted tabular-nums">
            {ordersList.length} commande{ordersList.length > 1 ? "s" : ""} au total
          </span>
        </header>
        <KanbanBoard orders={ordersList} />
      </div>

      {/* Mobile : Tabs + liste */}
      <div className="lg:hidden">
        <h2 className="text-base font-semibold mb-3">Commandes</h2>
        <MobileOrderList orders={ordersList} />
      </div>
    </div>
  );
}
