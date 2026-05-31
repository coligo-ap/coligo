"use client";

/**
 * Page COMMANDES = recherche + filtres + historique complet (consultation).
 * Complément du board live du dashboard : ici on retrouve TOUTES les commandes
 * (y compris récupérées / annulées), on cherche par nom / n° / téléphone, et on
 * ouvre le détail. Les actions d'avancement se font sur le board ou le détail.
 */

import Link from "next/link";
import { useMemo, useState } from "react";
import { Search, ChevronRight, Bike, Package, Clock } from "lucide-react";
import { cn, formatDA } from "@/lib/utils";
import {
  ORDER_STATUS_META,
  type OrderStatus,
  type OrderWithItems,
} from "@/lib/types";
import { Pagination } from "@/components/ui/pagination";

type StatusCounts = {
  all: number;
  pending: number;
  preparing: number;
  ready: number;
  completed: number;
  cancelled: number;
};

const FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "Toutes" },
  { key: "pending", label: "À confirmer" },
  { key: "preparing", label: "En préparation" },
  { key: "ready", label: "Prêtes" },
  { key: "completed", label: "Récupérées" },
  { key: "cancelled", label: "Annulées" },
];

const TONE_CLASSES: Record<string, string> = {
  amber: "bg-warning-50 text-warning-700",
  teal: "bg-primary-50 text-primary-700",
  green: "bg-success-50 text-success-700",
  stone: "bg-surface-3 text-muted",
  rose: "bg-danger-50 text-danger-700",
};

function fmtDate(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleDateString("fr-DZ", { day: "numeric", month: "short" });
}
function fmtTime(iso: string): string {
  return new Date(iso).toLocaleTimeString("fr-DZ", {
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function OrdersBrowser({
  orders,
  page,
  pageCount,
  total,
  filter,
  statusCounts,
}: {
  orders: OrderWithItems[];
  page: number;
  pageCount: number;
  total: number;
  filter: string;
  statusCounts: StatusCounts;
}) {
  const [q, setQ] = useState("");

  const countFor = (key: string): number =>
    key === "all"
      ? statusCounts.all
      : (statusCounts[key as keyof StatusCounts] ?? 0);

  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return orders;
    return orders.filter((o) => {
      const ref = (o.order_number ?? o.id.slice(0, 6)).toLowerCase();
      return (
        o.customer_name.toLowerCase().includes(needle) ||
        ref.includes(needle) ||
        (o.customer_phone ?? "").toLowerCase().includes(needle)
      );
    });
  }, [orders, q]);

  return (
    <div className="mx-auto max-w-[900px] p-4 lg:p-6 lg:px-8">
      <header className="mb-4">
        <p className="text-muted text-xs font-medium">Historique</p>
        <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">
          Commandes
        </h1>
      </header>

      {/* Recherche */}
      <div className="relative mb-3">
        <Search className="text-subtle absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Rechercher (nom, n°, téléphone)…"
          className="border-border bg-surface focus:border-primary-500 focus:ring-primary-100 h-11 w-full rounded-[12px] border pr-3 pl-9 text-sm outline-none focus:ring-2"
        />
      </div>

      {/* Filtres par statut (liens serveur, conservent la pagination à 1) */}
      <div className="mb-4 flex gap-1.5 overflow-x-auto pb-1">
        {FILTERS.map((f) => {
          const activeChip = filter === f.key;
          return (
            <Link
              key={f.key}
              href={`/orders?status=${f.key}`}
              className={cn(
                "inline-flex shrink-0 items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-semibold transition-colors",
                activeChip
                  ? "border-primary-600 bg-primary-600 text-white"
                  : "border-border text-muted hover:bg-surface-2 bg-white"
              )}
            >
              {f.label}
              <span
                className={cn(
                  "rounded-full px-1.5 text-[10px] tabular-nums",
                  activeChip ? "bg-white/20" : "bg-surface-3 text-subtle"
                )}
              >
                {countFor(f.key)}
              </span>
            </Link>
          );
        })}
      </div>

      {/* Liste */}
      {filtered.length === 0 ? (
        <div className="border-border text-subtle flex flex-col items-center justify-center gap-2 rounded-[16px] border border-dashed py-16">
          <Package className="size-6" />
          <p className="text-sm">Aucune commande</p>
        </div>
      ) : (
        <ul className="space-y-2">
          {filtered.map((o) => {
            const ref = o.order_number ?? o.id.slice(0, 6).toUpperCase();
            const meta = ORDER_STATUS_META[o.status as OrderStatus];
            const units = o.order_items.reduce(
              (s, it) => s + Number(it.quantity || 0),
              0
            );
            const isDelivery = o.fulfillment_type === "delivery";
            return (
              <li key={o.id}>
                <Link
                  href={`/orders/${o.id}`}
                  className="border-border bg-surface hover:bg-surface-2 flex items-center gap-3 rounded-[14px] border px-3.5 py-3 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="text-primary-700 font-mono text-sm font-extrabold">
                        #{ref}
                      </span>
                      <span
                        className={cn(
                          "rounded-full px-2 py-0.5 text-[10px] font-semibold",
                          TONE_CLASSES[meta.tone]
                        )}
                      >
                        {meta.label}
                      </span>
                      {isDelivery ? (
                        <Bike className="text-subtle size-3.5" />
                      ) : (
                        <Package className="text-subtle size-3.5" />
                      )}
                    </div>
                    <div className="text-muted mt-1 flex items-center gap-2 text-xs">
                      <span className="truncate font-medium">
                        {o.customer_name}
                      </span>
                      <span className="text-subtle">·</span>
                      <span className="shrink-0">{units} art.</span>
                      <span className="text-subtle">·</span>
                      <span className="inline-flex shrink-0 items-center gap-1">
                        <Clock className="size-3" />
                        {fmtDate(o.created_at)} {fmtTime(o.created_at)}
                      </span>
                    </div>
                  </div>
                  <div className="text-right">
                    <div className="text-foreground text-sm font-bold tabular-nums">
                      {formatDA(o.total_da)}
                    </div>
                  </div>
                  <ChevronRight className="text-subtle size-4 shrink-0" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      <div className="mt-5">
        <Pagination
          page={page}
          pageCount={pageCount}
          total={total}
          itemLabel={{ singular: "commande", plural: "commandes" }}
          hrefFor={(p) => `/orders?status=${filter}&page=${p}`}
        />
      </div>
    </div>
  );
}
