import { createClient } from "@/lib/supabase/server";
import Link from "next/link";
import {
  Bell,
  ChefHat,
  ChevronRight,
  Inbox,
  PackageCheck,
  QrCode,
} from "lucide-react";
import { ShopStatusToggle } from "@/components/merchant/shop-status-toggle";
import { OrdersCacheSync } from "@/components/merchant/orders-cache-sync";
import { formatDA, cn } from "@/lib/utils";
import { type OrderWithItems } from "@/lib/types";

export const dynamic = "force-dynamic";

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

  // Compteurs par statut actif (les commandes actives sont récentes → dans
  // les 100 dernières).
  const pendingCount = ordersList.filter((o) => o.status === "pending").length;
  const inPrepCount = ordersList.filter(
    (o) => o.status === "accepted" || o.status === "preparing"
  ).length;
  const readyCount = ordersList.filter((o) => o.status === "ready").length;

  // Gains du jour
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
    <div className="mx-auto max-w-[1100px] p-4 lg:p-6 lg:px-8">
      {/* Synchronise le snapshot serveur vers le cache Dexie (lecture offline). */}
      <OrdersCacheSync orders={ordersList} />

      {/* ─── Header : boutique + statut + cloche ─────────────────────────── */}
      <header className="mb-5 flex items-center justify-between gap-3">
        <div className="min-w-0">
          <p className="text-muted text-xs font-medium">Accueil</p>
          <h1 className="truncate text-2xl font-bold tracking-tight lg:text-3xl">
            {merchant?.name ?? "Ma boutique"}
          </h1>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <ShopStatusToggle initialPaused={merchant?.orders_paused ?? false} />
          <Link
            href="/orders?status=pending"
            aria-label="Commandes à confirmer"
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

      {/* ─── Bloc « Gagné aujourd'hui » ──────────────────────────────────── */}
      <section className="from-primary-600 to-primary-700 mb-5 rounded-[20px] bg-gradient-to-br p-5 text-white shadow-sm lg:p-6">
        <div className="flex items-end justify-between gap-4">
          <div>
            <p className="text-primary-100 text-sm font-medium">
              Gagné aujourd&apos;hui
            </p>
            <p className="mt-1 text-4xl font-bold tracking-tight tabular-nums lg:text-5xl">
              {formatDA(todayRevenue)}
            </p>
            <p className="text-primary-100 mt-1.5 text-sm">
              {todayOrders.length} commande{todayOrders.length > 1 ? "s" : ""}{" "}
              aujourd&apos;hui
            </p>
          </div>
          <Link
            href="/orders/validate"
            className="inline-flex shrink-0 items-center gap-1.5 rounded-full bg-white/15 px-3.5 py-2 text-sm font-semibold text-white backdrop-blur hover:bg-white/25"
          >
            <QrCode className="size-4" />
            <span className="hidden sm:inline">Valider</span>
          </Link>
        </div>
      </section>

      {/* ─── 3 grandes cartes cliquables par statut ──────────────────────── */}
      <section className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        <StatusCard
          href="/orders?status=pending"
          label="À confirmer"
          count={pendingCount}
          icon={Inbox}
          accent
        />
        <StatusCard
          href="/orders?status=preparing"
          label="En préparation"
          count={inPrepCount}
          icon={ChefHat}
        />
        <StatusCard
          href="/orders?status=ready"
          label="Prêtes"
          count={readyCount}
          icon={PackageCheck}
        />
      </section>
    </div>
  );
}

/**
 * Grande carte cliquable d'un statut → liste filtrée des commandes.
 * `accent` = mise en avant violette (réservée à « À confirmer », l'action
 * la plus urgente pour le commerçant).
 */
function StatusCard({
  href,
  label,
  count,
  icon: Icon,
  accent = false,
}: {
  href: string;
  label: string;
  count: number;
  icon: React.ComponentType<{ className?: string }>;
  accent?: boolean;
}) {
  return (
    <Link
      href={href}
      className={cn(
        "group relative flex flex-col justify-between overflow-hidden rounded-[18px] border p-5 transition-colors sm:min-h-[150px]",
        accent
          ? "border-primary-600 bg-primary-600 hover:bg-primary-700 text-white"
          : "border-border hover:bg-surface-2 bg-white"
      )}
    >
      <div className="flex items-center justify-between">
        <div
          className={cn(
            "flex size-10 items-center justify-center rounded-[12px]",
            accent ? "bg-white/15 text-white" : "bg-primary-50 text-primary-700"
          )}
        >
          <Icon className="size-5" />
        </div>
        <ChevronRight
          className={cn(
            "size-5 transition-transform group-hover:translate-x-0.5",
            accent ? "text-white/70" : "text-subtle"
          )}
        />
      </div>
      <div className="mt-4">
        <div className="text-4xl font-bold tabular-nums">{count}</div>
        <div
          className={cn(
            "mt-0.5 text-sm font-medium",
            accent ? "text-primary-100" : "text-muted"
          )}
        >
          {label}
        </div>
      </div>
    </Link>
  );
}
