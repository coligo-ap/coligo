import { createClient } from "@/lib/supabase/server";
import { KpiCard } from "@/components/merchant/kpi-card";
import { KanbanBoard } from "@/components/merchant/kanban-board";
import { MobileOrderList } from "@/components/merchant/order-list-mobile";
import Link from "next/link";
import { Inbox, ShoppingBag, TrendingUp, Clock, QrCode } from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { OrdersCacheSync } from "@/components/merchant/orders-cache-sync";
import { formatDA, cn } from "@/lib/utils";
import { type OrderWithItems } from "@/lib/types";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const supabase = await createClient();

  const { data: orders, error } = await supabase
    .from("orders")
    .select(
      `
      id, merchant_id, customer_name, customer_phone, status,
      total_da, pickup_code, pickup_slot_at, notes, created_at,
      fulfillment_type,
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
        <div className="rounded-[10px] border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-800">
          Erreur de chargement : {error.message}
        </div>
      </div>
    );
  }

  // Anti-fraude prompt 9 : pour les commandes LIVRAISON, on masque le
  // pickup_code côté commerçant. Le client communique son code au livreur ;
  // si le commerçant le voyait, il pourrait le transmettre à l'avance.
  const ordersList = (
    (orders ?? []) as unknown as (OrderWithItems & {
      fulfillment_type?: string;
    })[]
  ).map((o) =>
    o.fulfillment_type === "delivery"
      ? ({ ...o, pickup_code: "" } as OrderWithItems)
      : (o as OrderWithItems)
  );

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
    <div className="mx-auto max-w-[1600px] p-4 lg:p-6 lg:px-8">
      {/* Header */}
      <header className="mb-5 flex items-end justify-between gap-4 lg:mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">
            Tableau de bord
          </h1>
          <p className="text-muted mt-1 flex items-center gap-2 text-sm">
            <span className="inline-flex items-center gap-1.5">
              <span className="size-1.5 rounded-full bg-green-500" />
              En ligne
            </span>
            <span>·</span>
            <span>Vos commandes en temps réel</span>
          </p>
        </div>
        <Link
          href="/orders/validate"
          className={cn(buttonVariants({ size: "sm" }), "shrink-0")}
        >
          <QrCode className="size-4" />
          <span className="hidden sm:inline">Valider un retrait</span>
        </Link>
      </header>

      {/* Le pont Realtime + alertes est désormais monté par `MerchantShell`
          (actif sur TOUTES les pages commerçant). */}

      {/* Synchronise le snapshot serveur vers le cache Dexie pour la lecture
          offline (page /offline → "Voir les dernières commandes connues"). */}
      <OrdersCacheSync orders={ordersList} />

      {/* KPIs */}
      <section className="mb-6 grid grid-cols-2 gap-3 lg:mb-8 lg:grid-cols-4 lg:gap-4">
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
        <header className="mb-4 flex items-center justify-between">
          <h2 className="text-base font-semibold">Commandes</h2>
          <span className="text-muted text-xs tabular-nums">
            {ordersList.length} commande{ordersList.length > 1 ? "s" : ""} au
            total
          </span>
        </header>
        <KanbanBoard orders={ordersList} />
      </div>

      {/* Mobile : Tabs + liste */}
      <div className="lg:hidden">
        <h2 className="mb-3 text-base font-semibold">Commandes</h2>
        <MobileOrderList orders={ordersList} />
      </div>
    </div>
  );
}
