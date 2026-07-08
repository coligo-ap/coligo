"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import {
  Banknote,
  Car,
  ChevronLeft,
  ChevronRight,
  CreditCard,
  Loader2,
  MapPin,
  Search,
  User,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDA } from "@/lib/utils";
import type { AdminRideRow } from "@/lib/data/admin-rides";
import type { RidesExplorerFilters } from "@/lib/data/admin-rides-params";

// =============================================================================
// Recherche avancée des COURSES Drive (super-admin) — même mécanique que
// l'explorateur commandes : texte libre (client / téléphone / trajet),
// chauffeur, statut, paiement, période — filtres combinables portés par l'URL
// (router.replace + useTransition), recherche côté serveur (admin_search_rides).
// =============================================================================

export const RIDE_STATUS_META: Record<
  string,
  {
    label: string;
    tone: "warning" | "primary" | "success" | "neutral" | "danger";
  }
> = {
  searching: { label: "Recherche", tone: "warning" },
  scheduled: { label: "Programmée", tone: "neutral" },
  accepted: { label: "Acceptée", tone: "primary" },
  arriving: { label: "En approche", tone: "primary" },
  arrived: { label: "Chauffeur arrivé", tone: "primary" },
  in_progress: { label: "En course", tone: "primary" },
  completed: { label: "Terminée", tone: "success" },
  cancelled: { label: "Annulée", tone: "danger" },
};

const STATUS_OPTIONS = [
  { value: "", label: "Tous statuts" },
  { value: "active", label: "En cours" },
  { value: "searching", label: "Recherche" },
  { value: "scheduled", label: "Programmée" },
  { value: "accepted", label: "Acceptée" },
  { value: "arriving", label: "En approche" },
  { value: "arrived", label: "Chauffeur arrivé" },
  { value: "in_progress", label: "En course" },
  { value: "completed", label: "Terminée" },
  { value: "cancelled", label: "Annulée" },
];

const PAYMENT_OPTIONS = [
  { value: "", label: "Tout paiement" },
  { value: "cash", label: "Espèces" },
  { value: "coligo_pay", label: "Coligo Pay" },
  { value: "card", label: "Carte" },
];

function algiersToday(offsetDays = 0): string {
  const local = new Date(Date.now() + 3600_000);
  return new Date(
    Date.UTC(
      local.getUTCFullYear(),
      local.getUTCMonth(),
      local.getUTCDate() - offsetDays
    )
  )
    .toISOString()
    .slice(0, 10);
}

const DATE_PRESETS = [
  { key: "today", label: "Aujourd'hui", from: () => algiersToday(0) },
  { key: "7d", label: "7 jours", from: () => algiersToday(6) },
  { key: "30d", label: "30 jours", from: () => algiersToday(29) },
];

export function RidesExplorer({
  rows,
  total,
  page,
  pageSize,
  filters,
}: {
  rows: AdminRideRow[];
  total: number;
  page: number;
  pageSize: number;
  filters: RidesExplorerFilters;
}) {
  const router = useRouter();
  const [isPending, startTransition] = useTransition();
  const [q, setQ] = useState(filters.q ?? "");
  const [cq, setCq] = useState(filters.cq ?? "");
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const basePath = "/admin/chauffeurs/courses";

  const apply = (patch: Partial<RidesExplorerFilters>, resetPage = true) => {
    const next: RidesExplorerFilters = { ...filters, q, cq, ...patch };
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

  const applyDebounced = (patch: Partial<RidesExplorerFilters>) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => apply(patch), 400);
  };
  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    []
  );

  const activePreset =
    !filters.to && filters.from
      ? (DATE_PRESETS.find((p) => p.from() === filters.from)?.key ?? "custom")
      : filters.from || filters.to
        ? "custom"
        : "";

  const pageCount = Math.max(1, Math.ceil(total / pageSize));

  const chip = (active: boolean) =>
    "rounded-full px-3 py-1.5 text-xs font-semibold transition-colors " +
    (active
      ? "bg-primary-600 text-white"
      : "border-border text-muted hover:bg-surface-2 border");

  return (
    <div className="space-y-4">
      <div className="border-border bg-surface space-y-3 rounded-[14px] border p-3">
        <div className="relative">
          <Search className="text-muted pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2" />
          <input
            type="search"
            value={q}
            onChange={(e) => {
              setQ(e.target.value);
              applyDebounced({ q: e.target.value });
            }}
            placeholder="Client (nom, téléphone), trajet, id de course…"
            className="border-border bg-surface-2 h-11 w-full rounded-[12px] border pr-3 pl-10 text-sm outline-none"
          />
          {isPending && (
            <Loader2 className="text-muted absolute top-1/2 right-3 size-4 -translate-y-1/2 animate-spin" />
          )}
        </div>

        <div className="grid grid-cols-2 gap-2 lg:grid-cols-4">
          <div className="relative">
            <Car className="text-muted pointer-events-none absolute top-1/2 left-2.5 size-3.5 -translate-y-1/2" />
            <input
              value={cq}
              onChange={(e) => {
                setCq(e.target.value);
                applyDebounced({ cq: e.target.value });
              }}
              placeholder="Chauffeur…"
              className="border-border bg-surface h-10 w-full rounded-[10px] border pr-2 pl-8 text-[13px] outline-none"
            />
          </div>
          <select
            value={filters.st ?? ""}
            onChange={(e) => apply({ st: e.target.value })}
            className="border-border bg-surface h-10 rounded-[10px] border px-2.5 text-[13px] font-medium outline-none"
          >
            {STATUS_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <select
            value={filters.pm ?? ""}
            onChange={(e) => apply({ pm: e.target.value })}
            className="border-border bg-surface h-10 rounded-[10px] border px-2.5 text-[13px] font-medium outline-none"
          >
            {PAYMENT_OPTIONS.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
          <div className="col-span-2 flex flex-wrap items-center gap-1.5 lg:col-span-4">
            <button
              type="button"
              onClick={() => apply({ from: "", to: "" })}
              className={chip(activePreset === "")}
            >
              Tout
            </button>
            {DATE_PRESETS.map((p) => (
              <button
                key={p.key}
                type="button"
                onClick={() => apply({ from: p.from(), to: "" })}
                className={chip(activePreset === p.key)}
              >
                {p.label}
              </button>
            ))}
            <input
              type="date"
              value={filters.from ?? ""}
              onChange={(e) => apply({ from: e.target.value })}
              className="border-border bg-surface h-9 rounded-[10px] border px-2 text-xs outline-none"
              aria-label="Du"
            />
            <span className="text-muted text-xs">→</span>
            <input
              type="date"
              value={filters.to ?? ""}
              onChange={(e) => apply({ to: e.target.value })}
              className="border-border bg-surface h-9 rounded-[10px] border px-2 text-xs outline-none"
              aria-label="Au"
            />
          </div>
        </div>
      </div>

      <p className="text-muted text-xs font-semibold">
        {total} course{total > 1 ? "s" : ""}
        {isPending ? " · recherche…" : ""}
      </p>

      {rows.length === 0 ? (
        <p className="text-muted py-12 text-center text-sm">
          Aucune course ne correspond à ces filtres.
        </p>
      ) : (
        <ul
          className={
            "space-y-2 transition-opacity " + (isPending ? "opacity-60" : "")
          }
        >
          {rows.map((r) => {
            const meta = RIDE_STATUS_META[r.status];
            return (
              <li key={r.id}>
                <Link
                  href={`/admin/chauffeurs/courses/${r.id}`}
                  className="border-border bg-surface hover:border-primary-200 hover:bg-primary-50/30 flex items-center gap-3 rounded-[14px] border p-3.5 transition-colors"
                >
                  <div className="min-w-0 flex-1">
                    <div className="flex flex-wrap items-center gap-1.5">
                      <Badge tone={meta?.tone ?? "neutral"}>
                        {meta?.label ?? r.status}
                      </Badge>
                      {r.gamme && <Badge tone="neutral">{r.gamme}</Badge>}
                      {r.admin_refunded_da > 0 && (
                        <Badge tone="primary">Remboursée part.</Badge>
                      )}
                      {r.cancelled_by === "admin" && (
                        <Badge tone="neutral">par le support</Badge>
                      )}
                    </div>
                    <p className="text-muted mt-1 flex flex-wrap items-center gap-x-2 truncate text-xs">
                      <span className="inline-flex items-center gap-1">
                        <User className="size-3" />
                        {r.customer_name ?? "Client"}
                      </span>
                      {r.chauffeur_name && (
                        <span className="inline-flex items-center gap-1">
                          <Car className="size-3" />
                          {r.chauffeur_name}
                        </span>
                      )}
                    </p>
                    {(r.pickup_text || r.dest_text) && (
                      <p className="text-subtle mt-0.5 flex items-center gap-1 truncate text-[11px]">
                        <MapPin className="size-3 shrink-0" />
                        {[r.pickup_text, r.dest_text]
                          .filter(Boolean)
                          .join(" → ")}
                      </p>
                    )}
                    <p className="text-subtle mt-0.5 text-[11px]">
                      {new Date(r.created_at).toLocaleString("fr-DZ", {
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
                      {formatDA(r.price_da)}
                    </p>
                    <p className="text-muted mt-0.5 inline-flex items-center gap-1 text-[11px]">
                      {r.payment_method === "cash" ? (
                        <Banknote className="size-3" />
                      ) : r.payment_method === "card" ? (
                        <CreditCard className="size-3" />
                      ) : (
                        <Wallet className="size-3" />
                      )}
                      {r.payment_method === "cash"
                        ? "Espèces"
                        : r.payment_method === "card"
                          ? "Carte"
                          : "Coligo Pay"}
                    </p>
                  </div>
                  <ChevronRight className="text-subtle size-4 shrink-0" />
                </Link>
              </li>
            );
          })}
        </ul>
      )}

      {pageCount > 1 && (
        <div className="flex items-center justify-center gap-2 pt-1">
          <button
            type="button"
            onClick={() => apply({ page: page - 1 }, false)}
            disabled={page <= 1 || isPending}
            className="border-border hover:bg-surface-2 inline-flex size-9 items-center justify-center rounded-[10px] border disabled:opacity-40"
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
            className="border-border hover:bg-surface-2 inline-flex size-9 items-center justify-center rounded-[10px] border disabled:opacity-40"
            aria-label="Page suivante"
          >
            <ChevronRight className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}
