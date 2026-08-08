"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Banknote,
  Bike,
  ChevronLeft,
  ChevronRight,
  ChevronRight as Chevron,
  CreditCard,
  Loader2,
  Search,
  Store,
  User,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDA } from "@/lib/utils";
import { ORDER_STATUS_META, type OrderStatus } from "@/lib/types";
import type { AdminOrderRow } from "@/lib/data/admin-orders";

// =============================================================================
// Recherche avancée des commandes (super-admin) : texte libre (n° / client /
// téléphone), commerçant, livreur, statut, paiement, mode, période — filtres
// COMBINABLES, matérialisés dans l'URL (partageable, back/forward OK). La
// recherche s'exécute CÔTÉ SERVEUR (RPC admin_search_orders) : chaque
// changement met à jour les searchParams via router.replace + useTransition
// (pas de flash loading.tsx, indicateur discret pendant le fetch).
// =============================================================================

export type ExplorerFilters = {
  q?: string;
  mq?: string;
  dq?: string;
  st?: string;
  pm?: string;
  ps?: string;
  ft?: string;
  dm?: string;
  from?: string;
  to?: string;
  page?: number;
};

const STATUS_OPTIONS: { value: string; label: string }[] = [
  { value: "", label: "Tous statuts" },
  { value: "active", label: "En cours" },
  { value: "pending", label: "À confirmer" },
  { value: "accepted", label: "Acceptée" },
  { value: "preparing", label: "En préparation" },
  { value: "ready", label: "Prête" },
  { value: "completed", label: "Terminée" },
  { value: "cancelled", label: "Annulée" },
];

const PAYMENT_METHOD_OPTIONS = [
  { value: "", label: "Tout paiement" },
  { value: "cash", label: "Espèces" },
  { value: "online", label: "En ligne (carte)" },
];

const PAYMENT_STATUS_OPTIONS = [
  { value: "", label: "Tout état" },
  { value: "pending", label: "En attente" },
  { value: "paid", label: "Payée" },
  { value: "failed", label: "Échec" },
  { value: "refunded", label: "Remboursée" },
];

const MODE_OPTIONS = [
  { value: "", label: "Tout mode" },
  { value: "pickup", label: "Retrait" },
  { value: "delivery:express", label: "Livraison express" },
  { value: "delivery:tour", label: "Livraison tournée" },
];

/** Date locale Alger (UTC+1) → YYYY-MM-DD. */
function algiersToday(offsetDays = 0): string {
  const local = new Date(Date.now() + 3600_000);
  const d = new Date(
    Date.UTC(
      local.getUTCFullYear(),
      local.getUTCMonth(),
      local.getUTCDate() - offsetDays
    )
  );
  return d.toISOString().slice(0, 10);
}

const DATE_PRESETS: { key: string; label: string; from: () => string }[] = [
  { key: "today", label: "Aujourd'hui", from: () => algiersToday(0) },
  { key: "7d", label: "7 jours", from: () => algiersToday(6) },
  { key: "30d", label: "30 jours", from: () => algiersToday(29) },
];

function selectCls() {
  return "border-border bg-surface h-10 rounded-control border px-2.5 text-body-sm font-medium outline-none";
}

export function AdminOrdersExplorer({
  rows,
  total,
  page,
  pageSize,
  filters,
  basePath,
}: {
  rows: AdminOrderRow[];
  total: number;
  page: number;
  pageSize: number;
  filters: ExplorerFilters;
  basePath: string;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();

  // Champs texte contrôlés localement + debounce vers l'URL.
  const [q, setQ] = useState(filters.q ?? "");
  const [mq, setMq] = useState(filters.mq ?? "");
  const [dq, setDq] = useState(filters.dq ?? "");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const apply = (patch: Partial<ExplorerFilters>, resetPage = true) => {
    const next: ExplorerFilters = { ...filters, q, mq, dq, ...patch };
    if (resetPage) next.page = 1;
    const params = new URLSearchParams();
    for (const [k, v] of Object.entries(next)) {
      if (v === undefined || v === null || String(v) === "") continue;
      if (k === "page" && Number(v) <= 1) continue;
      params.set(k, String(v));
    }
    const qs = params.toString();
    startTransition(() => {
      router.replace(qs ? `${basePath}?${qs}` : basePath, { scroll: false });
    });
  };

  const applyDebounced = (patch: Partial<ExplorerFilters>) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => apply(patch), 400);
  };
  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    []
  );

  // Préréglage de période actif (déduit de from/to).
  const activePreset =
    !filters.to && filters.from
      ? (DATE_PRESETS.find((p) => p.from() === filters.from)?.key ?? "custom")
      : filters.from || filters.to
        ? "custom"
        : "";

  const modeValue = filters.ft
    ? filters.ft === "pickup"
      ? "pickup"
      : `delivery:${filters.dm ?? "express"}`
    : "";

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  return (
    <div className="space-y-4">
      {/* ---- Barre de recherche + filtres ---- */}
      <div className="border-border bg-surface rounded-card-lg space-y-3 border p-3">
        <div className="relative">
          <Search className="text-muted pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2" />
          <input
            type="search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              applyDebounced({ q: e.target.value });
            }}
            placeholder="N° de commande, nom ou téléphone du client…"
            className="border-border bg-surface-2 h-11 w-full rounded-md border pr-3 pl-10 text-sm outline-none"
          />
          {isPending && (
            <Loader2 className="text-muted absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin" />
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <div className="relative">
            <Store className="text-muted pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
            <input
              value={mq}
              onChange={(e) => {
                setMq(e.target.value);
                applyDebounced({ mq: e.target.value });
              }}
              placeholder="Commerçant…"
              className="border-border bg-surface rounded-control text-body-sm h-10 w-full border pr-2 pl-8 outline-none"
            />
          </div>
          <div className="relative">
            <Bike className="text-muted pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
            <input
              value={dq}
              onChange={(e) => {
                setDq(e.target.value);
                applyDebounced({ dq: e.target.value });
              }}
              placeholder="Livreur…"
              className="border-border bg-surface rounded-control text-body-sm h-10 w-full border pr-2 pl-8 outline-none"
            />
          </div>
          <select
            value={filters.st ?? ""}
            onChange={(e) => apply({ st: e.target.value })}
            className={selectCls()}
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select
            value={modeValue}
            onChange={(e) => {
              const v = e.target.value;
              if (!v) apply({ ft: "", dm: "" });
              else if (v === "pickup") apply({ ft: "pickup", dm: "" });
              else apply({ ft: "delivery", dm: v.split(":")[1] });
            }}
            className={selectCls()}
          >
            {MODE_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select
            value={filters.pm ?? ""}
            onChange={(e) => apply({ pm: e.target.value })}
            className={selectCls()}
          >
            {PAYMENT_METHOD_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select
            value={filters.ps ?? ""}
            onChange={(e) => apply({ ps: e.target.value })}
            className={selectCls()}
          >
            {PAYMENT_STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>

          {/* Période — presets + personnalisé */}
          <div className="col-span-2 flex flex-wrap items-center gap-1.5">
            <button
              type="button"
              onClick={() => apply({ from: "", to: "" })}
              className={periodChip(activePreset === "")}
            >
              Tout
            </button>
            {DATE_PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => apply({ from: p.from(), to: "" })}
                className={periodChip(activePreset === p.key)}
              >
                {p.label}
              </button>
            ))}
            <input
              type="date"
              value={filters.from ?? ""}
              onChange={(e) => apply({ from: e.target.value })}
              className="border-border bg-surface rounded-control h-9 border px-2 text-xs outline-none"
              aria-label="Du"
            />
            <span className="text-muted text-xs">→</span>
            <input
              type="date"
              value={filters.to ?? ""}
              onChange={(e) => apply({ to: e.target.value })}
              className="border-border bg-surface rounded-control h-9 border px-2 text-xs outline-none"
              aria-label="Au"
            />
          </div>
        </div>
      </div>

      {/* ---- Résultats ---- */}
      <p className="text-muted text-xs font-semibold">
        {total} commande{total > 1 ? "s" : ""}
        {isPending ? " · recherche…" : ""}
      </p>

      {rows.length === 0 ? (
        <p className="text-muted py-12 text-center text-sm">
          Aucune commande ne correspond à ces filtres.
        </p>
      ) : (
        <ul
          className={
            "space-y-2 transition-opacity " + (isPending ? "opacity-60" : "")
          }
        >
          {rows.map((r) => (
            <OrderRowCard key={r.id} row={r} />
          ))}
        </ul>
      )}

      {/* ---- Pagination serveur ---- */}
      {pageCount > 1 && (
        <div className="flex items-center justify-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => apply({ page: page - 1 }, false)}
            disabled={page <= 1 || isPending}
            className="border-border hover:bg-surface-2 rounded-control inline-flex size-9 items-center justify-center border disabled:opacity-40"
            aria-label="Page précédente"
          >
            <ChevronLeft className="size-4" />
          </button>
          <span className="text-muted px-2 text-sm tabular-nums">
            Page {page} / {pageCount}
          </span>
          <button
            type="button"
            onClick={() => apply({ page: page + 1 }, false)}
            disabled={page >= pageCount || isPending}
            className="border-border hover:bg-surface-2 rounded-control inline-flex size-9 items-center justify-center border disabled:opacity-40"
            aria-label="Page suivante"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}

function periodChip(active: boolean) {
  return (
    "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors " +
    (active
      ? "bg-primary-600 text-white"
      : "border-border text-muted hover:bg-surface-2 border")
  );
}

function OrderRowCard({ row }: { row: AdminOrderRow }) {
  const meta = ORDER_STATUS_META[row.status as OrderStatus];
  const isDelivery = row.fulfillment_type === "delivery";
  const statusLabel =
    row.status === "completed" && isDelivery
      ? "Livrée"
      : (meta?.label ?? row.status);

  return (
    <li>
      <Link
        href={`/admin/orders/${row.id}`}
        className="border-border bg-surface hover:border-primary-200 hover:bg-primary-50/30 rounded-card-lg flex items-center gap-3 border p-3.5 transition-colors"
      >
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="font-mono text-sm font-bold">
              #{row.order_number ?? row.id.slice(0, 6).toUpperCase()}
            </span>
            <Badge tone={meta?.tone ?? "neutral"}>{statusLabel}</Badge>
            {row.delivery_no_show_at && <Badge tone="warning">No-show</Badge>}
            {row.delivery_failed_at && <Badge tone="danger">Échec</Badge>}
            {row.admin_refunded_da > 0 && (
              <Badge tone="primary">
                Remboursée {row.payment_status !== "refunded" ? "part." : ""}
              </Badge>
            )}
          </div>
          <p className="text-muted mt-1 flex flex-wrap items-center gap-x-2 truncate text-xs">
            <span className="inline-flex items-center gap-1">
              <Store className="size-3" />
              {row.merchant_name}
            </span>
            <span className="inline-flex items-center gap-1">
              <User className="size-3" />
              {row.customer_name ?? "Client"}
            </span>
            {row.driver_name && (
              <span className="inline-flex items-center gap-1">
                <Bike className="size-3" />
                {row.driver_name}
              </span>
            )}
          </p>
          <p className="text-subtle text-caption mt-0.5">
            {isDelivery
              ? row.delivery_mode === "tour"
                ? "Livraison tournée"
                : "Livraison express"
              : "Retrait"}{" "}
            ·{" "}
            {new Date(row.created_at).toLocaleString("fr-DZ", {
              timeZone: "Africa/Algiers",
              day: "2-digit",
              month: "2-digit",
              hour: "2-digit",
              minute: "2-digit",
            })}
          </p>
        </div>
        <div className="shrink-0 text-right">
          <p className="text-sm font-bold tabular-nums">
            {formatDA(row.total_da)}
          </p>
          <p className="text-muted text-caption mt-0.5 inline-flex items-center gap-1">
            {row.payment_method === "online" ? (
              <CreditCard className="size-3" />
            ) : (
              <Banknote className="size-3" />
            )}
            {row.payment_method === "online" ? "En ligne" : "Espèces"} ·{" "}
            {{
              pending: "à payer",
              paid: "payée",
              failed: "échec",
              refunded: "remboursée",
            }[row.payment_status] ?? row.payment_status}
          </p>
        </div>
        <Chevron className="text-subtle size-4 shrink-0" />
      </Link>
    </li>
  );
}
