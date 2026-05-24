"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Filter, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { getCategoryLabel } from "@/lib/config/categories";

// =============================================================================
// MarketplaceSearchBar — barre de recherche placée en HAUT de la home,
// juste sous le LocationBanner. Reste sticky pendant le scroll.
//
// Cousin du composant `MarketplaceGrid` (placé plus bas dans la page) : les
// deux ne se parlent QUE via les URL params (q, category, sort, open_now).
// Ce découplage permet de rendre la barre proche du header et la grille à
// l'endroit logique, sans context React.
// =============================================================================

type Filters = {
  q: string;
  category: string;
  sort: "name" | "min_order";
  openNow: boolean;
};

const EMPTY: Filters = {
  q: "",
  category: "",
  sort: "name",
  openNow: false,
};

type Props = {
  categories: { name: string; count: number }[];
};

export function MarketplaceSearchBar({ categories }: Props) {
  const router = useRouter();
  const params = useSearchParams();

  const filters = useMemo<Filters>(
    () => ({
      q: params.get("q") ?? "",
      category: params.get("category") ?? "",
      sort: params.get("sort") === "min_order" ? "min_order" : "name",
      openNow: params.get("open_now") === "1",
    }),
    [params]
  );

  // Buffer local pour l'input texte — debounce → URL.
  const [qBuffer, setQBuffer] = useState(filters.q);
  useEffect(() => setQBuffer(filters.q), [filters.q]);

  const [sheetOpen, setSheetOpen] = useState(false);

  function pushFilters(next: Filters, opts: { replace?: boolean } = {}) {
    const usp = new URLSearchParams();
    if (next.q) usp.set("q", next.q);
    if (next.category) usp.set("category", next.category);
    if (next.sort !== "name") usp.set("sort", next.sort);
    if (next.openNow) usp.set("open_now", "1");
    const qs = usp.toString();
    const url = qs ? `/?${qs}` : "/";
    if (opts.replace) router.replace(url, { scroll: false });
    else router.push(url, { scroll: false });
  }

  // Debounce 350ms sur le champ texte.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (qBuffer === filters.q) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      pushFilters({ ...filters, q: qBuffer }, { replace: true });
    }, 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qBuffer]);

  function reset() {
    setQBuffer("");
    pushFilters(EMPTY);
  }

  const hasActiveFilter =
    !!filters.q ||
    !!filters.category ||
    filters.openNow ||
    filters.sort !== "name";

  return (
    <>
      {/* Sticky sous le CustomerHeader. Mobile : ~57 px (py-3 + contenu).
          Desktop : 64 px (h-16). z-20 pour passer au-dessus des contenus,
          mais en dessous du header (z-30) et des modales (z-50). */}
      <div className="bg-surface-2 sticky top-[57px] z-20 -mx-4 px-4 py-2 lg:top-16 lg:-mx-6 lg:px-6">
        <form
          className="flex items-center gap-2"
          onSubmit={(e) => {
            e.preventDefault();
            if (debounceRef.current) clearTimeout(debounceRef.current);
            pushFilters({ ...filters, q: qBuffer }, { replace: true });
          }}
        >
          <div className="relative flex-1">
            <Search className="text-muted pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
            <input
              type="search"
              value={qBuffer}
              onChange={(e) => setQBuffer(e.target.value)}
              placeholder="Rechercher un commerce…"
              className="border-border bg-surface focus-visible:ring-primary-400/40 focus-visible:border-primary-400 h-11 w-full rounded-[12px] border pr-10 pl-9 text-sm focus-visible:ring-2 focus-visible:outline-none"
              aria-label="Rechercher un commerce"
            />
            {qBuffer && (
              <button
                type="button"
                onClick={() => setQBuffer("")}
                className="text-muted hover:text-foreground absolute top-1/2 right-2 -translate-y-1/2 rounded-full p-1"
                aria-label="Effacer la recherche"
              >
                <X className="size-4" />
              </button>
            )}
          </div>
          <button
            type="button"
            onClick={() => setSheetOpen(true)}
            className={cn(
              "border-border hover:bg-surface-2 bg-surface inline-flex h-11 items-center gap-1.5 rounded-[12px] border px-3 text-sm font-medium",
              hasActiveFilter &&
                "border-primary-400 bg-primary-50 text-primary-700"
            )}
            aria-label="Filtres"
          >
            <Filter className="size-4" />
            <span className="hidden sm:inline">Filtres</span>
            {hasActiveFilter && (
              <span className="bg-primary-600 inline-flex size-4 items-center justify-center rounded-full text-[10px] font-bold text-white">
                ●
              </span>
            )}
          </button>
        </form>
      </div>

      {sheetOpen && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
          onClick={(e) => {
            if (e.target === e.currentTarget) setSheetOpen(false);
          }}
        >
          <div className="bg-surface max-h-[85vh] w-full max-w-md overflow-y-auto rounded-t-[20px] p-5 shadow-xl sm:rounded-[20px]">
            <FilterSheet
              filters={filters}
              categories={categories}
              onApply={(next) => {
                pushFilters(next);
                setSheetOpen(false);
              }}
              onReset={() => {
                reset();
                setSheetOpen(false);
              }}
              onClose={() => setSheetOpen(false)}
            />
          </div>
        </div>
      )}
    </>
  );
}

function FilterSheet({
  filters,
  categories,
  onApply,
  onReset,
  onClose,
}: {
  filters: Filters;
  categories: { name: string; count: number }[];
  onApply: (next: Filters) => void;
  onReset: () => void;
  onClose: () => void;
}) {
  const [draft, setDraft] = useState<Filters>(filters);
  useEffect(() => setDraft(filters), [filters]);

  return (
    <div className="space-y-4">
      <header className="flex items-center justify-between">
        <h2 className="text-foreground text-base font-bold">Filtres</h2>
        <button
          type="button"
          onClick={onClose}
          className="text-muted hover:bg-surface-2 rounded-full p-1.5"
          aria-label="Fermer"
        >
          <X className="size-4" />
        </button>
      </header>

      <div className="space-y-1.5">
        <Label>Catégorie</Label>
        <select
          value={draft.category}
          onChange={(e) =>
            setDraft((f) => ({ ...f, category: e.target.value }))
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
        <Label>Trier par</Label>
        <select
          value={draft.sort}
          onChange={(e) =>
            setDraft((f) => ({
              ...f,
              sort: e.target.value === "min_order" ? "min_order" : "name",
            }))
          }
          className={SELECT}
        >
          <option value="name">Nom (A → Z)</option>
          <option value="min_order">Minimum de commande</option>
        </select>
      </div>

      <label className="hover:bg-surface-2 flex cursor-pointer items-start gap-2 rounded-[10px] p-2">
        <input
          type="checkbox"
          checked={draft.openNow}
          onChange={(e) =>
            setDraft((f) => ({ ...f, openNow: e.target.checked }))
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
        <Button type="button" onClick={() => onApply(draft)} className="flex-1">
          Appliquer
        </Button>
        <Button type="button" onClick={onReset} variant="outline">
          Effacer
        </Button>
      </div>
    </div>
  );
}

const SELECT =
  "border-border-strong bg-surface focus-visible:ring-primary-400/40 focus-visible:border-primary-400 h-10 w-full rounded-[10px] border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none";
