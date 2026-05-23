"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Filter, Loader2, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { WILAYAS } from "@/lib/config/wilayas";
import { getCommunes } from "@/lib/config/communes";
import { getCategoryLabel } from "@/lib/config/categories";
import { isOpenNow } from "@/lib/merchant/opening-hours";
import { MerchantCard } from "@/components/customer/merchant-card";
import type { PublicMerchant } from "@/lib/data/merchants-public";

type Filters = {
  q: string;
  category: string;
  wilaya: string;
  commune: string;
  sort: "name" | "min_order";
  openNow: boolean;
};

type Props = {
  initialResults: PublicMerchant[];
  initial: Filters;
  categories: { name: string; count: number }[];
};

export function SearchView({ initialResults, initial, categories }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const [filters, setFilters] = useState<Filters>(initial);
  const [pending, startTransition] = useTransition();
  const [sheetOpen, setSheetOpen] = useState(false);

  const communes = useMemo(() => getCommunes(filters.wilaya), [filters.wilaya]);

  // Filtre "ouvert maintenant" appliqué CÔTÉ CLIENT (calculé à la volée).
  const results = useMemo(() => {
    if (!filters.openNow) return initialResults;
    return initialResults.filter((m) => isOpenNow(m.opening_hours));
  }, [filters.openNow, initialResults]);

  // Quand un filtre serveur change, on pousse les params dans l'URL.
  function applyServerFilters(next: Filters) {
    const usp = new URLSearchParams();
    if (next.q) usp.set("q", next.q);
    if (next.category) usp.set("category", next.category);
    if (next.wilaya) usp.set("wilaya", next.wilaya);
    if (next.commune) usp.set("commune", next.commune);
    if (next.sort !== "name") usp.set("sort", next.sort);
    if (next.openNow) usp.set("open_now", "1");
    startTransition(() => {
      router.push(`/search${usp.toString() ? `?${usp.toString()}` : ""}`);
    });
  }

  // Sync state quand l'URL change (back / nav).
  useEffect(() => {
    setFilters({
      q: params.get("q") ?? "",
      category: params.get("category") ?? "",
      wilaya: params.get("wilaya") ?? "",
      commune: params.get("commune") ?? "",
      sort: (params.get("sort") === "min_order" ? "min_order" : "name") as
        | "name"
        | "min_order",
      openNow: params.get("open_now") === "1",
    });
  }, [params]);

  function reset() {
    const empty: Filters = {
      q: "",
      category: "",
      wilaya: "",
      commune: "",
      sort: "name",
      openNow: false,
    };
    setFilters(empty);
    applyServerFilters(empty);
  }

  const filterPanel = (
    <FilterPanel
      filters={filters}
      setFilters={setFilters}
      categories={categories}
      communes={communes}
      onApply={() => {
        applyServerFilters(filters);
        setSheetOpen(false);
      }}
      onReset={reset}
      pending={pending}
    />
  );

  return (
    <div className="grid gap-6 lg:grid-cols-[260px_1fr]">
      {/* Sidebar filtres desktop */}
      <aside className="hidden lg:block">
        <div className="border-border bg-surface rounded-[16px] border p-4">
          {filterPanel}
        </div>
      </aside>

      <section className="space-y-4">
        {/* Bar recherche + filtres trigger mobile */}
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            applyServerFilters(filters);
          }}
        >
          <div className="relative flex-1">
            <Search className="text-subtle pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <Input
              value={filters.q}
              onChange={(e) => setFilters((f) => ({ ...f, q: e.target.value }))}
              placeholder="Rechercher un commerce, une spécialité…"
              className="pl-9"
            />
          </div>
          <Button type="submit" disabled={pending}>
            {pending ? (
              <Loader2 className="size-4 animate-spin" />
            ) : (
              "Rechercher"
            )}
          </Button>
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className="border-border hover:bg-surface-2 inline-flex items-center gap-1.5 rounded-[10px] border px-3 py-2 text-sm font-medium lg:hidden"
          >
            <Filter className="size-4" />
            Filtres
          </button>
        </form>

        <div className="text-muted flex items-center justify-between text-xs">
          <span>
            {results.length} commerce{results.length > 1 ? "s" : ""} trouvé
            {results.length > 1 ? "s" : ""}
          </span>
          {(filters.q ||
            filters.category ||
            filters.wilaya ||
            filters.commune ||
            filters.openNow) && (
            <button
              type="button"
              onClick={reset}
              className="text-primary-700 hover:underline"
            >
              Effacer les filtres
            </button>
          )}
        </div>

        {results.length === 0 ? (
          <div className="border-border bg-surface text-muted rounded-[16px] border px-6 py-12 text-center text-sm">
            Aucun commerce ne correspond à ta recherche.
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {results.map((m) => (
              <MerchantCard key={m.id} merchant={m} />
            ))}
          </div>
        )}
      </section>

      {/* Sheet mobile */}
      {sheetOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 lg:hidden"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSheetOpen(false);
          }}
        >
          <div className="bg-surface max-h-[85vh] w-full overflow-y-auto rounded-t-[20px] p-5 shadow-xl">
            <header className="mb-4 flex items-center justify-between">
              <h2 className="text-base font-bold">Filtres</h2>
              <button
                type="button"
                onClick={() => setSheetOpen(false)}
                className="text-muted hover:bg-surface-2 rounded-full p-1.5"
              >
                <X className="size-4" />
              </button>
            </header>
            {filterPanel}
          </div>
        </div>
      )}
    </div>
  );
}

function FilterPanel({
  filters,
  setFilters,
  categories,
  communes,
  onApply,
  onReset,
  pending,
}: {
  filters: Filters;
  setFilters: React.Dispatch<React.SetStateAction<Filters>>;
  categories: { name: string; count: number }[];
  communes: string[];
  onApply: () => void;
  onReset: () => void;
  pending: boolean;
}) {
  return (
    <div className="space-y-4">
      <div className="space-y-1.5">
        <Label>Catégorie</Label>
        <select
          value={filters.category}
          onChange={(e) =>
            setFilters((f) => ({ ...f, category: e.target.value }))
          }
          className={SELECT}
        >
          <option value="">Toutes</option>
          {categories.map((c) => (
            <option key={c.name} value={c.name}>
              {getCategoryLabel(c.name)} ({c.count})
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <Label>Wilaya</Label>
        <select
          value={filters.wilaya}
          onChange={(e) =>
            setFilters((f) => ({ ...f, wilaya: e.target.value, commune: "" }))
          }
          className={SELECT}
        >
          <option value="">Toutes</option>
          {WILAYAS.map((w) => (
            <option key={w.code} value={w.code}>
              {w.code} · {w.name}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <Label>Commune</Label>
        <select
          value={filters.commune}
          onChange={(e) =>
            setFilters((f) => ({ ...f, commune: e.target.value }))
          }
          disabled={!filters.wilaya || communes.length === 0}
          className={cn(SELECT, "disabled:opacity-50")}
        >
          <option value="">Toutes</option>
          {communes.map((c) => (
            <option key={c} value={c}>
              {c}
            </option>
          ))}
        </select>
      </div>

      <div className="space-y-1.5">
        <Label>Trier par</Label>
        <select
          value={filters.sort}
          onChange={(e) =>
            setFilters((f) => ({
              ...f,
              sort: e.target.value === "min_order" ? "min_order" : "name",
            }))
          }
          className={SELECT}
        >
          <option value="name">Nom</option>
          <option value="min_order">Minimum de commande</option>
        </select>
      </div>

      <label className="hover:bg-surface-2 flex cursor-pointer items-start gap-2 rounded-[10px] p-2">
        <input
          type="checkbox"
          checked={filters.openNow}
          onChange={(e) =>
            setFilters((f) => ({ ...f, openNow: e.target.checked }))
          }
          className="accent-primary-600 mt-0.5 size-4"
        />
        <span className="text-sm">
          <span className="text-foreground block font-medium">
            Ouvert maintenant
          </span>
          <span className="text-muted block text-xs">
            Calculé selon les horaires affichés.
          </span>
        </span>
      </label>

      <div className="flex gap-2 pt-2">
        <Button onClick={onApply} className="flex-1" disabled={pending}>
          {pending && <Loader2 className="size-4 animate-spin" />}
          Appliquer
        </Button>
        <Button onClick={onReset} variant="outline" disabled={pending}>
          Effacer
        </Button>
      </div>
    </div>
  );
}

const SELECT =
  "border-border-strong bg-surface focus-visible:ring-primary-400/40 focus-visible:border-primary-400 h-10 w-full rounded-[10px] border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none";
