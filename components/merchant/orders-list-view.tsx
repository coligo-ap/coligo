"use client";

import Link from "next/link";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import {
  Search,
  QrCode,
  ArrowRight,
  Loader2,
  ChevronRight,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { toast } from "@/components/ui/toast";
import {
  cn,
  countItems,
  formatDA,
  formatRelativeTime,
  formatTime,
} from "@/lib/utils";
import {
  ORDER_STATUS_META,
  nextOrderAction,
  type OrderStatus,
  type OrderWithItems,
} from "@/lib/types";
import { updateOrderStatus } from "@/app/(merchant)/orders/actions";

type FilterKey =
  | "all"
  | "pending"
  | "preparing"
  | "ready"
  | "completed"
  | "cancelled";

const FILTERS: { key: FilterKey; label: string; statuses: OrderStatus[] }[] = [
  { key: "all", label: "Toutes", statuses: [] },
  { key: "pending", label: "À confirmer", statuses: ["pending"] },
  {
    key: "preparing",
    label: "En préparation",
    statuses: ["accepted", "preparing"],
  },
  { key: "ready", label: "Prêtes", statuses: ["ready"] },
  { key: "completed", label: "Récupérées", statuses: ["completed"] },
  { key: "cancelled", label: "Annulées", statuses: ["cancelled"] },
];

export function OrdersListView({ orders }: { orders: OrderWithItems[] }) {
  const [filter, setFilter] = useState<FilterKey>("all");
  const [query, setQuery] = useState("");

  const counts = useMemo(() => {
    const map: Record<FilterKey, number> = {
      all: orders.length,
      pending: 0,
      preparing: 0,
      ready: 0,
      completed: 0,
      cancelled: 0,
    };
    for (const o of orders) {
      if (o.status === "pending") map.pending++;
      else if (o.status === "accepted" || o.status === "preparing")
        map.preparing++;
      else if (o.status === "ready") map.ready++;
      else if (o.status === "completed") map.completed++;
      else if (o.status === "cancelled") map.cancelled++;
    }
    return map;
  }, [orders]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const statuses = FILTERS.find((f) => f.key === filter)?.statuses ?? [];
    return orders.filter((o) => {
      if (statuses.length > 0 && !statuses.includes(o.status)) return false;
      if (!q) return true;
      return (
        o.customer_name.toLowerCase().includes(q) ||
        o.id.slice(0, 6).toLowerCase().includes(q) ||
        o.customer_phone.includes(q)
      );
    });
  }, [orders, filter, query]);

  return (
    <div className="mx-auto max-w-[1600px] p-4 lg:p-6 lg:px-8">
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">
            Commandes
          </h1>
          <p className="text-muted mt-1 text-sm">
            {orders.length} commande{orders.length > 1 ? "s" : ""} au total
          </p>
        </div>
        <Link
          href="/orders/validate"
          className={buttonVariants({ size: "sm" })}
        >
          <QrCode className="size-4" />
          Valider un retrait
        </Link>
      </header>

      {/* Recherche */}
      <div className="relative mb-4 lg:max-w-md">
        <Search className="text-subtle pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <input
          type="search"
          placeholder="Rechercher : n° de commande, client, téléphone…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="border-border-strong focus:border-primary-400 focus:ring-primary-400/40 h-11 w-full rounded-[12px] border bg-white pr-3 pl-9 text-sm focus:ring-2 focus:outline-none"
        />
      </div>

      {/* Filtres par statut */}
      <div className="-mx-1 mb-5 flex gap-1.5 overflow-x-auto px-1 pb-1 lg:flex-wrap lg:overflow-visible lg:pb-0">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => setFilter(f.key)}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors",
              filter === f.key
                ? "border-primary-600 bg-primary-600 text-white"
                : "border-border-strong text-muted hover:bg-surface-2"
            )}
          >
            {f.label}
            <span
              className={cn(
                "tabular-nums",
                filter === f.key ? "text-white/80" : "text-subtle"
              )}
            >
              {counts[f.key]}
            </span>
          </button>
        ))}
      </div>

      {filtered.length === 0 ? (
        <p className="text-muted py-12 text-center text-sm">
          Aucune commande ne correspond.
        </p>
      ) : (
        <>
          {/* Desktop : tableau dense */}
          <div className="border-border bg-surface hidden overflow-hidden rounded-[16px] border lg:block">
            <table className="w-full text-sm">
              <thead className="border-border text-muted border-b text-left text-xs">
                <tr>
                  <th className="px-4 py-3 font-medium">N°</th>
                  <th className="px-4 py-3 font-medium">Client</th>
                  <th className="px-4 py-3 font-medium">Articles</th>
                  <th className="px-4 py-3 text-right font-medium">Total</th>
                  <th className="px-4 py-3 font-medium">Statut</th>
                  <th className="px-4 py-3 font-medium">Retrait</th>
                  <th className="px-4 py-3 font-medium"></th>
                </tr>
              </thead>
              <tbody className="divide-border divide-y">
                {filtered.map((o) => (
                  <OrderRow key={o.id} order={o} />
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile : cartes */}
          <div className="space-y-3 lg:hidden">
            {filtered.map((o) => (
              <OrderMobileCard key={o.id} order={o} />
            ))}
          </div>
        </>
      )}
    </div>
  );
}

function useQuickAdvance(order: OrderWithItems) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const next = nextOrderAction(order.status);

  function advance() {
    if (!next) return;
    const operationId = crypto.randomUUID();
    startTransition(async () => {
      const res = await updateOrderStatus(order.id, next.to, operationId);
      if (res.error) {
        toast.error(res.error);
        return;
      }
      toast.success(`Commande : ${ORDER_STATUS_META[next.to].label}`);
      router.refresh();
    });
  }

  return { next, pending, advance };
}

function OrderRow({ order }: { order: OrderWithItems }) {
  const meta = ORDER_STATUS_META[order.status];
  const shortId = order.id.slice(0, 6).toUpperCase();
  const { next, pending, advance } = useQuickAdvance(order);

  return (
    <tr className="hover:bg-surface-2 transition-colors">
      <td className="px-4 py-3">
        <Link
          href={`/orders/${order.id}`}
          className="font-mono text-xs font-semibold hover:underline"
        >
          #{shortId}
        </Link>
      </td>
      <td className="px-4 py-3">
        <div className="font-medium">{order.customer_name}</div>
        <div className="text-subtle text-xs">{order.customer_phone}</div>
      </td>
      <td className="text-muted px-4 py-3 tabular-nums">
        {countItems(order.order_items)}
      </td>
      <td className="px-4 py-3 text-right font-semibold tabular-nums">
        {formatDA(order.total_da)}
      </td>
      <td className="px-4 py-3">
        <Badge tone={meta.tone}>{meta.label}</Badge>
      </td>
      <td className="text-muted px-4 py-3">
        {formatTime(order.pickup_slot_at)}
      </td>
      <td className="px-4 py-3 text-right">
        {order.status === "ready" ? (
          <Link
            href="/orders/validate"
            className="text-primary-700 hover:bg-primary-50 inline-flex items-center gap-1 rounded-[8px] px-2 py-1.5 text-xs font-medium"
          >
            <QrCode className="size-4" />
            Valider
          </Link>
        ) : next ? (
          <button
            type="button"
            onClick={advance}
            disabled={pending}
            className="text-primary-700 hover:bg-primary-50 inline-flex items-center gap-1 rounded-[8px] px-2 py-1.5 text-xs font-medium disabled:opacity-50"
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <ArrowRight className="size-4" />
            )}
            {next.label.replace("la commande", "").trim() || "Avancer"}
          </button>
        ) : (
          <Link
            href={`/orders/${order.id}`}
            className="text-subtle hover:text-foreground inline-flex items-center"
          >
            <ChevronRight className="size-4" />
          </Link>
        )}
      </td>
    </tr>
  );
}

function OrderMobileCard({ order }: { order: OrderWithItems }) {
  const meta = ORDER_STATUS_META[order.status];
  const shortId = order.id.slice(0, 6).toUpperCase();
  const { next, pending, advance } = useQuickAdvance(order);

  return (
    <div className="border-border bg-surface rounded-[14px] border p-4">
      <Link href={`/orders/${order.id}`} className="block">
        <div className="mb-2 flex items-start justify-between gap-3">
          <div>
            <span className="font-mono text-sm font-semibold">#{shortId}</span>
            <div className="text-muted text-xs">
              {formatRelativeTime(order.created_at)}
            </div>
          </div>
          <Badge tone={meta.tone}>{meta.label}</Badge>
        </div>
        <div className="mb-1 text-sm font-medium">{order.customer_name}</div>
        <div className="text-muted mb-3 flex items-center justify-between text-xs">
          <span>Retrait à {formatTime(order.pickup_slot_at)}</span>
          <span className="text-foreground text-sm font-semibold tabular-nums">
            {formatDA(order.total_da)}
          </span>
        </div>
      </Link>
      {order.status === "ready" ? (
        <Link
          href="/orders/validate"
          className={cn(buttonVariants({ size: "sm" }), "w-full")}
        >
          <QrCode className="size-4" />
          Valider le retrait
        </Link>
      ) : (
        next && (
          <button
            type="button"
            onClick={advance}
            disabled={pending}
            className="border-border-strong hover:bg-surface-2 flex h-9 w-full items-center justify-center gap-1.5 rounded-[10px] border text-xs font-medium disabled:opacity-50"
          >
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              <ArrowRight className="size-4" />
            )}
            {next.label}
          </button>
        )
      )}
    </div>
  );
}
