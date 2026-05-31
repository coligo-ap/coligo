import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import { Bell, QrCode, TrendingUp } from "lucide-react";
import { ShopStatusToggle } from "@/components/merchant/shop-status-toggle";
import { OrdersCacheSync } from "@/components/merchant/orders-cache-sync";
import { OrderBoard } from "@/components/merchant/order-board";
import { formatDA } from "@/lib/utils";
import { type OrderWithItems } from "@/lib/types";

export const dynamic = "force-dynamic";

/**
 * DASHBOARD = centre de pilotage live. Bandeau résumé du jour en haut +
 * BOARD opérationnel (À confirmer → En préparation → Prêtes) où l'on fait
 * avancer chaque commande d'un tap. Pensé pour gérer beaucoup de commandes/jour.
 * Le board se rafraîchit via `OrderRealtimeBridge` (router.refresh()).
 */
export default async function DashboardPage() {
  const supabase = await createClient();

  const {
    data: { user },
  } = await supabase.auth.getUser();

  const { data: merchant } = await supabase
    .from("merchants")
    .select("id, name, orders_paused")
    .eq("user_id", user?.id ?? "")
    .maybeSingle();

  const { data: orders, error } = await supabase
    .from("orders")
    .select(
      `
      id, merchant_id, customer_name, customer_phone, status,
      total_da, pickup_code, order_number, pickup_slot_at, notes, created_at,
      payment_method, payment_status, fulfillment_type,
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

  // Anti-fraude : masquer pickup_code des livraisons côté commerçant.
  const ordersList = (
    (orders ?? []) as unknown as (OrderWithItems & {
      fulfillment_type?: string;
    })[]
  ).map((o) =>
    o.fulfillment_type === "delivery"
      ? ({ ...o, pickup_code: "" } as OrderWithItems)
      : (o as OrderWithItems)
  );

  // Commandes ACTIVES pour le board (le reste = historique sur /orders).
  const activeOrders = ordersList.filter((o) =>
    ["pending", "accepted", "preparing", "ready"].includes(o.status)
  );
  const pendingCount = ordersList.filter((o) => o.status === "pending").length;

  // Stats du jour (Algérie : on s'appuie sur l'heure locale du serveur Vercel
  // — suffisant pour le résumé ; le détail comptable est dans Finances).
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
    <div className="mx-auto max-w-[1200px] p-4 lg:p-6 lg:px-8">
      <OrdersCacheSync orders={ordersList} />

      {/* ─── Header : boutique + statut + cloche ─── */}
      <header className="mb-4 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-muted text-xs font-medium">Pilotage</p>
          <h1 className="truncate text-2xl font-bold tracking-tight lg:text-3xl">
            {merchant?.name ?? "Ma boutique"}
          </h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ShopStatusToggle initialPaused={merchant?.orders_paused ?? false} />
          <Link
            href="/orders"
            aria-label="Toutes les commandes"
            className="hover:bg-surface-3 text-muted border-border relative flex size-10 items-center justify-center rounded-full border bg-white"
          >
            <Bell className="size-4" />
            {pendingCount > 0 && (
              <span className="absolute -top-1 -right-1 inline-flex min-w-[18px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white ring-2 ring-white">
                {pendingCount}
              </span>
            )}
          </Link>
        </div>
      </header>

      {/* ─── Bandeau résumé du jour (compact) ─── */}
      <section className="from-primary-600 to-primary-700 mb-5 flex items-center justify-between gap-4 rounded-[18px] bg-gradient-to-br p-4 text-white shadow-sm lg:p-5">
        <div className="flex items-center gap-4 lg:gap-6">
          <div>
            <p className="text-primary-100 inline-flex items-center gap-1.5 text-xs font-medium">
              <TrendingUp className="size-3.5" />
              Gagné aujourd&apos;hui
            </p>
            <p className="mt-0.5 text-2xl font-bold tracking-tight tabular-nums lg:text-4xl">
              {formatDA(todayRevenue)}
            </p>
          </div>
          <div className="border-l border-white/20 pl-4 lg:pl-6">
            <p className="text-primary-100 text-xs font-medium">Commandes</p>
            <p className="mt-0.5 text-2xl font-bold tabular-nums lg:text-4xl">
              {todayOrders.length}
            </p>
          </div>
        </div>
        <Link
          href="/orders/validate"
          className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white/15 px-4 py-2.5 text-sm font-semibold text-white backdrop-blur hover:bg-white/25"
        >
          <QrCode className="size-4" />
          <span className="hidden sm:inline">Valider un retrait</span>
          <span className="sm:hidden">Valider</span>
        </Link>
      </section>

      {/* ─── Board opérationnel live ─── */}
      <OrderBoard orders={activeOrders} />
    </div>
  );
}
