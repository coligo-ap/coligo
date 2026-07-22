"use client";

import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import Link from "next/link";
import {
  Ban,
  ChevronRight,
  Loader2,
  MapPin,
  ShieldOff,
  Star,
  Users,
} from "lucide-react";
import { cn, formatDA } from "@/lib/utils";
import { SearchInput, Pager } from "@/components/admin/shared/list-controls";
import { searchCustomersAction } from "@/app/admin/(clients)/clients/actions";
import type {
  CustomerRow,
  CustomersPage,
  CustomerStatusFilter,
} from "@/lib/admin/customer-features";

// =============================================================================
// Annuaire CLIENTS — recherche SERVEUR (nom / téléphone / e-mail / handle Pay),
// filtres d'état et pagination.
//
// La recherche est serveur (la base cliente peut être immense), mais l'écran
// reste instantané : frappe débattue 250 ms, page précédente CONSERVÉE pendant
// le chargement, et cache local par clé (requête+filtre+page) → revenir sur une
// recherche déjà faite ne recharge rien.
// =============================================================================

const FILTERS: { key: CustomerStatusFilter; label: string }[] = [
  { key: "all", label: "Tous" },
  { key: "active", label: "Actifs" },
  { key: "blocked", label: "Suspendus" },
  { key: "restricted", label: "Restreints" },
  { key: "cod_blocked", label: "Paiement livraison bloqué" },
];

const keyOf = (q: string, s: CustomerStatusFilter, p: number) =>
  `${s}|${p}|${q.trim().toLowerCase()}`;

export function CustomersView({ initial }: { initial: CustomersPage }) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState<CustomerStatusFilter>("all");
  const [page, setPage] = useState(1);
  const [data, setData] = useState<CustomersPage>(initial);
  const [pending, startTransition] = useTransition();

  // Cache module-local : une combinaison déjà chargée se réaffiche sans réseau.
  const cache = useRef(new Map<string, CustomersPage>());
  useEffect(() => {
    cache.current.set(keyOf("", "all", 1), initial);
  }, [initial]);

  const load = useCallback((q: string, s: CustomerStatusFilter, p: number) => {
    const k = keyOf(q, s, p);
    const hit = cache.current.get(k);
    if (hit) {
      setData(hit);
      return;
    }
    startTransition(async () => {
      const res = await searchCustomersAction({ q, status: s, page: p });
      cache.current.set(k, res);
      setData(res);
    });
  }, []);

  // Frappe débattue — on ne part pas au serveur à chaque caractère.
  useEffect(() => {
    const id = setTimeout(() => load(query, status, page), 250);
    return () => clearTimeout(id);
  }, [query, status, page, load]);

  const pageCount = Math.max(1, Math.ceil(data.total / data.pageSize));

  return (
    <div className="mx-auto max-w-5xl p-4 lg:p-6">
      <header className="mb-4">
        <h2 className="flex items-center gap-2 text-xl font-bold tracking-tight">
          <Users className="size-5" />
          Annuaire clients
        </h2>
        <p className="text-muted mt-1 text-sm">
          Rechercher un client, suspendre son compte, couper une fonctionnalité
          ou consulter sa dernière position connue.
        </p>
      </header>

      <SearchInput
        value={query}
        onChange={(v) => {
          setQuery(v);
          setPage(1);
        }}
        placeholder="Nom, téléphone, e-mail ou handle Coligo Pay…"
      />

      <div className="scrollbar-hide -mx-1 mt-3 flex gap-1.5 overflow-x-auto px-1">
        {FILTERS.map((f) => (
          <button
            key={f.key}
            type="button"
            onClick={() => {
              setStatus(f.key);
              setPage(1);
            }}
            className={cn(
              "shrink-0 rounded-full px-3 py-1.5 text-[13px] font-semibold transition-colors",
              status === f.key
                ? "bg-primary-600 text-white"
                : "border-border text-muted hover:bg-surface-2 border"
            )}
          >
            {f.label}
          </button>
        ))}
      </div>

      <div className="text-muted mt-3 flex items-center gap-2 text-[13px]">
        <span className="tabular-nums">
          {data.total} client{data.total > 1 ? "s" : ""}
        </span>
        {pending && <Loader2 className="size-3.5 animate-spin" />}
      </div>

      <ul className={cn("mt-2 space-y-2.5", pending && "opacity-60")}>
        {data.rows.map((c) => (
          <CustomerCard key={c.id} c={c} />
        ))}
      </ul>

      {data.rows.length === 0 && !pending && (
        <p className="text-muted border-border mt-4 rounded-[14px] border border-dashed p-6 text-center text-sm">
          Aucun client ne correspond.
        </p>
      )}

      <Pager
        page={data.page}
        pageCount={pageCount}
        onPage={setPage}
        className="mt-5"
      />
    </div>
  );
}

function CustomerCard({ c }: { c: CustomerRow }) {
  const place =
    c.last_city ?? [c.commune, c.wilaya_code].filter(Boolean).join(" · ");
  const restricted = c.blocked_features.length > 0;

  return (
    <li>
      <Link
        href={`/admin/clients/${c.id}`}
        prefetch
        className="border-border bg-surface hover:bg-surface-2 flex items-center gap-3 rounded-[14px] border p-3 transition-colors"
      >
        <span
          className={cn(
            "grid size-10 shrink-0 place-items-center rounded-full text-sm font-bold",
            c.is_blocked
              ? "bg-danger-100 text-danger-700"
              : "bg-primary-100 text-primary-700"
          )}
          aria-hidden
        >
          {(c.full_name || "?").slice(0, 1).toUpperCase()}
        </span>

        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-1.5">
            <span className="text-foreground truncate font-semibold">
              {c.full_name || "Sans nom"}
            </span>
            {c.is_blocked && (
              <span className="bg-danger-100 text-danger-700 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold">
                <Ban className="size-3" /> Suspendu
              </span>
            )}
            {restricted && (
              <span className="bg-warning-100 text-warning-800 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold">
                <ShieldOff className="size-3" />
                {c.blocked_features.length} coupure
                {c.blocked_features.length > 1 ? "s" : ""}
              </span>
            )}
            {c.cod_blocked && (
              <span className="bg-surface-2 text-muted rounded-full px-2 py-0.5 text-[11px] font-semibold">
                COD bloqué
              </span>
            )}
          </span>

          <span className="text-muted mt-0.5 block truncate text-[13px]">
            {[c.phone, c.email].filter(Boolean).join(" · ") || "—"}
          </span>

          <span className="text-muted mt-1 flex flex-wrap items-center gap-x-3 gap-y-0.5 text-[12px] tabular-nums">
            <span>
              {c.orders_count} cmd · {formatDA(c.spend_da)}
            </span>
            {c.rides_count > 0 && <span>{c.rides_count} course(s)</span>}
            {c.rating_count > 0 && (
              <span className="inline-flex items-center gap-0.5">
                <Star className="size-3" />
                {c.rating_avg.toFixed(1)}
              </span>
            )}
            {place && (
              <span className="inline-flex items-center gap-1 truncate">
                <MapPin className="size-3" />
                {place}
              </span>
            )}
          </span>
        </span>

        <ChevronRight className="text-subtle size-4 shrink-0" />
      </Link>
    </li>
  );
}
