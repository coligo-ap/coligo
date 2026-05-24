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
  Zap,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { buttonVariants } from "@/components/ui/button";
import { Pagination } from "@/components/ui/pagination";
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
  type OrderWithItems,
  type PrintWidth,
} from "@/lib/types";
import { enqueueOrExecute } from "@/lib/offline/queue";
import { PrintOrderButton } from "@/components/ticket/print-order-button";
import { orderToTicket } from "@/lib/ticket/order-to-ticket";
import { OrdersCacheSync } from "@/components/merchant/orders-cache-sync";

const FILTERS: { key: string; label: string }[] = [
  { key: "all", label: "Toutes" },
  { key: "pending", label: "À confirmer" },
  { key: "preparing", label: "En préparation" },
  { key: "ready", label: "Prêtes" },
  { key: "completed", label: "Récupérées" },
  { key: "cancelled", label: "Annulées" },
];

type StatusCounts = {
  all: number;
  pending: number;
  preparing: number;
  ready: number;
  completed: number;
  cancelled: number;
};

type ListProps = {
  orders: OrderWithItems[];
  merchantName: string;
  printWidth: PrintWidth;
  printCopies: number;
  categoryMap: Record<string, string>;
  page: number;
  pageCount: number;
  total: number;
  filter: string;
  statusCounts: StatusCounts;
};

export function OrdersListView({
  orders,
  merchantName,
  printWidth,
  printCopies,
  categoryMap,
  page,
  pageCount,
  total,
  filter,
  statusCounts,
}: ListProps) {
  // Recherche : reste in-memory et ne s'applique qu'à la page courante.
  // Pour une recherche globale, il faudrait l'envoyer en URL — overkill pour
  // MVP où le commerçant trouve sa commande via le filtre statut + page.
  const [query, setQuery] = useState("");

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = !q
      ? orders
      : orders.filter(
          (o) =>
            o.customer_name.toLowerCase().includes(q) ||
            o.id.slice(0, 6).toLowerCase().includes(q) ||
            o.customer_phone.includes(q)
        );
    // Priorité visuelle : online+paid en tête (sur la page courante). Garde
    // l'ordre chronologique relatif pour les autres + entre online+paid.
    // (Le tri DB reste created_at desc — pas de saut entre pages.)
    return [...base].sort((a, b) => {
      const ap = isOnlinePaid(a) ? 0 : 1;
      const bp = isOnlinePaid(b) ? 0 : 1;
      return ap - bp;
    });
  }, [orders, query]);

  // Construit l'URL pour une page donnée en gardant le filtre courant.
  function hrefFor(p: number): string {
    const params = new URLSearchParams();
    if (filter && filter !== "all") params.set("status", filter);
    if (p > 1) params.set("page", String(p));
    const qs = params.toString();
    return qs ? `/orders?${qs}` : "/orders";
  }

  // Construit l'URL pour un filtre donné (revient page 1).
  function filterHref(key: string): string {
    if (key === "all") return "/orders";
    return `/orders?status=${key}`;
  }

  return (
    <div className="mx-auto max-w-[1600px] p-4 lg:p-6 lg:px-8">
      {/* Cache local pour lecture offline (mis à jour à chaque rendu). */}
      <OrdersCacheSync orders={orders} />
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">
            Commandes
          </h1>
          <p className="text-muted mt-1 text-sm">
            {total} commande{total > 1 ? "s" : ""} au total
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

      {/* Recherche sur la page courante */}
      <div className="relative mb-4 lg:max-w-md">
        <Search className="text-subtle pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <input
          type="search"
          placeholder="Filtrer cette page : n°, client, téléphone…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          className="border-border-strong focus:border-primary-400 focus:ring-primary-400/40 h-11 w-full rounded-[12px] border bg-white pr-3 pl-9 text-sm focus:ring-2 focus:outline-none"
        />
      </div>

      {/* Filtres par statut — URL-based, comptage total de chaque statut */}
      <div className="-mx-1 mb-5 flex gap-1.5 overflow-x-auto px-1 pb-1 lg:flex-wrap lg:overflow-visible lg:pb-0">
        {FILTERS.map((f) => {
          const active = filter === f.key;
          const count = statusCounts[f.key as keyof StatusCounts];
          return (
            <Link
              key={f.key}
              href={filterHref(f.key)}
              prefetch={false}
              className={cn(
                "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors",
                active
                  ? "border-primary-600 bg-primary-600 text-white"
                  : "border-border-strong text-muted hover:bg-surface-2"
              )}
            >
              {f.label}
              <span
                className={cn(
                  "tabular-nums",
                  active ? "text-white/80" : "text-subtle"
                )}
              >
                {count}
              </span>
            </Link>
          );
        })}
      </div>

      {filtered.length === 0 ? (
        <p className="text-muted py-12 text-center text-sm">
          {query
            ? "Aucune commande sur cette page ne correspond à la recherche."
            : "Aucune commande."}
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
                  <OrderRow
                    key={o.id}
                    order={o}
                    merchantName={merchantName}
                    printWidth={printWidth}
                    printCopies={printCopies}
                    categoryMap={categoryMap}
                  />
                ))}
              </tbody>
            </table>
          </div>

          {/* Mobile : liste de cartes · Tablette : grille 2 colonnes */}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:hidden">
            {filtered.map((o) => (
              <OrderMobileCard
                key={o.id}
                order={o}
                merchantName={merchantName}
                printWidth={printWidth}
                printCopies={printCopies}
                categoryMap={categoryMap}
              />
            ))}
          </div>
        </>
      )}

      <div className="mt-5">
        <Pagination
          page={page}
          pageCount={pageCount}
          hrefFor={hrefFor}
          total={total}
          itemLabel={{ singular: "commande", plural: "commandes" }}
        />
      </div>
    </div>
  );
}

function useQuickAdvance(order: OrderWithItems) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const next = nextOrderAction(order.status);

  function advance() {
    if (!next) return;
    startTransition(async () => {
      try {
        const outcome = await enqueueOrExecute({
          type: "update_status",
          orderId: order.id,
          to: next.to,
        });
        if (outcome.mode === "queued") {
          toast.info(
            `Hors ligne — « ${ORDER_STATUS_META[next.to].label} » sera synchronisé.`
          );
          return;
        }
        const res = outcome.result;
        if (res.error) {
          toast.error(res.error);
          return;
        }
        toast.success(`Commande : ${ORDER_STATUS_META[next.to].label}`);
        router.refresh();
      } catch (e) {
        toast.error(e instanceof Error ? e.message : "Erreur inattendue.");
      }
    });
  }

  return { next, pending, advance };
}

type RowProps = {
  order: OrderWithItems;
  merchantName: string;
  printWidth: PrintWidth;
  printCopies: number;
  categoryMap: Record<string, string>;
};

function OrderRow({
  order,
  merchantName,
  printWidth,
  printCopies,
  categoryMap,
}: RowProps) {
  const meta = ORDER_STATUS_META[order.status];
  const shortId = order.id.slice(0, 6).toUpperCase();
  const { next, pending, advance } = useQuickAdvance(order);

  const onlinePaid = isOnlinePaid(order);
  return (
    <tr
      className={cn(
        "hover:bg-surface-2 transition-colors",
        onlinePaid && "border-l-success-500 border-l-[3px]"
      )}
    >
      <td className="px-4 py-3">
        <Link
          href={`/orders/${order.id}`}
          className="font-mono text-xs font-semibold hover:underline"
        >
          #{shortId}
        </Link>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-2">
          <span className="font-medium">{order.customer_name}</span>
          {onlinePaid && <OnlinePaidBadge />}
        </div>
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
        <div className="flex items-center justify-end gap-1">
          <PrintOrderButton
            order={orderToTicket(order, merchantName, categoryMap)}
            width={printWidth}
            copies={printCopies}
            variant="icon"
          />
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
        </div>
      </td>
    </tr>
  );
}

// =============================================================================
// OnlinePaidBadge — badge ⚡ vert pour les commandes Chargily déjà encaissées.
// =============================================================================
// Pulse doux (ring qui s'élargit) — pas de clignotement agressif. L'objectif
// est d'attirer l'œil sans saturer le CPU sur les téléphones d'entrée de gamme
// que beaucoup de commerçants utilisent.
function OnlinePaidBadge({ size = "sm" }: { size?: "sm" | "md" }) {
  return (
    <span
      className={cn(
        "border-success-200 bg-success-100 text-success-800 relative inline-flex items-center gap-1 rounded-full border font-semibold whitespace-nowrap",
        size === "md" ? "px-2 py-0.5 text-xs" : "px-1.5 py-0.5 text-[10px]"
      )}
      title="Cette commande est déjà payée en ligne — priorité."
    >
      <Zap
        className={cn(size === "md" ? "size-3.5" : "size-3", "fill-current")}
      />
      Payé en ligne
      {/* Ring pulsant (animation Tailwind ping) — doux car opacité diminue. */}
      <span className="border-success-400 absolute inset-0 -m-0.5 animate-ping rounded-full border opacity-40" />
    </span>
  );
}

function isOnlinePaid(order: OrderWithItems): boolean {
  return order.payment_method === "online" && order.payment_status === "paid";
}

function OrderMobileCard({
  order,
  merchantName,
  printWidth,
  printCopies,
  categoryMap,
}: RowProps) {
  const meta = ORDER_STATUS_META[order.status];
  const shortId = order.id.slice(0, 6).toUpperCase();
  const { next, pending, advance } = useQuickAdvance(order);
  const onlinePaid = isOnlinePaid(order);

  return (
    <div
      className={cn(
        "border-border bg-surface rounded-[14px] border p-4",
        onlinePaid && "border-l-success-500 border-l-[3px]"
      )}
    >
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
        <div className="mb-1 flex items-center gap-2">
          <span className="text-sm font-medium">{order.customer_name}</span>
          {onlinePaid && <OnlinePaidBadge />}
        </div>
        <div className="text-muted mb-3 flex items-center justify-between text-xs">
          <span>Retrait à {formatTime(order.pickup_slot_at)}</span>
          <span className="text-foreground text-sm font-semibold tabular-nums">
            {formatDA(order.total_da)}
          </span>
        </div>
      </Link>
      <div className="flex items-center gap-2">
        {order.status === "ready" ? (
          <Link
            href="/orders/validate"
            className={cn(buttonVariants({ size: "sm" }), "flex-1")}
          >
            <QrCode className="size-4" />
            Valider
          </Link>
        ) : (
          next && (
            <button
              type="button"
              onClick={advance}
              disabled={pending}
              className="border-border-strong hover:bg-surface-2 flex h-9 flex-1 items-center justify-center gap-1.5 rounded-[10px] border text-xs font-medium disabled:opacity-50"
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
        <PrintOrderButton
          order={orderToTicket(order, merchantName, categoryMap)}
          width={printWidth}
          copies={printCopies}
          variant="icon"
        />
      </div>
    </div>
  );
}
