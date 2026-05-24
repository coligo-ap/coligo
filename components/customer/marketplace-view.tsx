"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Filter, Loader2, MapPin, Search, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { cn } from "@/lib/utils";
import { useCustomerLocation } from "@/lib/customer/location-store";
import { WILAYAS } from "@/lib/config/wilayas";
import { getCategoryLabel } from "@/lib/config/categories";
import { isOpenNow } from "@/lib/merchant/opening-hours";
import { fetchMerchantsForZone } from "@/app/(customer)/actions";
import { MerchantCard } from "@/components/customer/merchant-card";
import type { PublicMerchant } from "@/lib/data/merchants-public";

// =============================================================================
// MarketplaceView — barre de recherche unique + filtres + liste, en place.
// =============================================================================
// Plus de page /search dédiée : la home assume search + filtres + résultats.
// Les filtres serveur (q, category, sort) sont reflétés dans l'URL (?q=…)
// pour préserver l'historique navigateur et les URLs partageables.
// Le filtre `openNow` est appliqué côté client (calcul depuis opening_hours).
//
// La zone (wilaya/commune) est gérée séparément par le LocationBanner — on
// se contente de la lire et de la passer au refetch.
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
  /** Liste initiale (server-side, "tous les commerces actifs"). */
  fallback: PublicMerchant[];
  /** Liste des catégories DB (avec counts) — pour le sélecteur filtre. */
  categories: { name: string; count: number }[];
};

export function MarketplaceView({ fallback, categories }: Props) {
  const router = useRouter();
  const params = useSearchParams();
  const loc = useCustomerLocation();

  // Filtres lus depuis l'URL — recalculés à chaque navigation/back.
  const filters = useMemo<Filters>(
    () => ({
      q: params.get("q") ?? "",
      category: params.get("category") ?? "",
      sort: params.get("sort") === "min_order" ? "min_order" : "name",
      openNow: params.get("open_now") === "1",
    }),
    [params]
  );

  // Buffer local pour l'input texte — debounce → URL → refetch.
  const [qBuffer, setQBuffer] = useState(filters.q);
  // Sync si l'URL est changée d'ailleurs (ex. clic sur CategoryStrip).
  useEffect(() => {
    setQBuffer(filters.q);
  }, [filters.q]);

  const [items, setItems] = useState<PublicMerchant[]>(fallback);
  const [emptyZone, setEmptyZone] = useState(false);
  const [pending, startTransition] = useTransition();
  const [sheetOpen, setSheetOpen] = useState(false);

  // Re-fetch dès que filtres serveur OU zone changent.
  // (location store renvoie `null` au 1er render → on attend qu'il soit hydraté.)
  useEffect(() => {
    if (loc === null) return;
    startTransition(async () => {
      const res = await fetchMerchantsForZone({
        wilaya_code: loc.wilaya_code,
        commune: loc.commune,
        q: filters.q || null,
        category: filters.category || null,
        sort: filters.sort,
      });
      if (res.length === 0 && loc.wilaya_code) {
        // Aucun commerce dans la zone : on bascule sur fallback (vue large).
        setItems(fallback);
        setEmptyZone(true);
      } else {
        setItems(res);
        setEmptyZone(false);
      }
    });
  }, [loc, filters.q, filters.category, filters.sort, fallback]);

  // openNow appliqué CÔTÉ CLIENT (sinon décalages d'horaires serveur/client).
  const visible = useMemo(() => {
    if (!filters.openNow) return items;
    return items.filter((m) => isOpenNow(m.opening_hours));
  }, [filters.openNow, items]);

  // -----------------------------------------------------------------------
  // Navigation : on pousse les filtres dans l'URL. router.replace pour ne
  // pas polluer l'historique avec chaque frappe (q debounce).
  // -----------------------------------------------------------------------
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

  // Debounce 350ms sur le champ de recherche.
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

  const wilayaLabel = loc?.wilaya_code
    ? WILAYAS.find((w) => w.code === loc.wilaya_code)?.name
    : null;

  const hasActiveFilter =
    !!filters.q ||
    !!filters.category ||
    filters.openNow ||
    filters.sort !== "name";

  return (
    <div className="space-y-4">
      {/* ------------------------------------------------------------------- */}
      {/* Barre de recherche — sticky sous le header pendant le scroll.       */}
      {/* `top-` matche la hauteur header desktop (h-16 = 4rem) ; sur mobile, */}
      {/* le header sticky a un layout plus haut (~5rem). On joue safe avec   */}
      {/* `top-16 lg:top-16` (le header occupe ~64px sur les deux). Le mobile */}
      {/* header a la search bar retirée → seul le bloc location reste.      */}
      {/* ------------------------------------------------------------------- */}
      <div className="bg-surface-2 sticky top-16 z-20 -mx-4 px-4 py-2 lg:-mx-6 lg:px-6">
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

      {/* ------------------------------------------------------------------- */}
      {/* Titre contextuel + état chargement.                                 */}
      {/* ------------------------------------------------------------------- */}
      <div className="flex items-baseline justify-between gap-3">
        <h2 className="text-foreground text-base font-bold lg:text-xl">
          {emptyZone
            ? "Tous les commerces en Algérie"
            : filters.q
              ? `Résultats pour « ${filters.q} »`
              : filters.category
                ? `Catégorie : ${getCategoryLabel(filters.category)}`
                : wilayaLabel
                  ? `Commerces à ${wilayaLabel}${loc?.commune ? ` · ${loc.commune}` : ""}`
                  : "Commerces en Algérie"}
        </h2>
        {pending && <Loader2 className="text-muted size-4 animate-spin" />}
      </div>

      {/* Hint "pas de commerces dans ta zone" */}
      {emptyZone && wilayaLabel && !filters.q && !filters.category && (
        <div className="border-warning-100 bg-warning-50 text-warning-800 flex items-start gap-2 rounded-[14px] border px-3 py-2 text-xs">
          <MapPin className="text-warning-600 mt-0.5 size-3.5 shrink-0" />
          <span>
            Pas encore de commerces à <strong>{wilayaLabel}</strong> — en
            attendant, voici ceux disponibles ailleurs.
          </span>
        </div>
      )}

      {/* Récap filtres actifs + reset */}
      {hasActiveFilter && (
        <div className="text-muted flex items-center justify-between text-xs">
          <span>
            {visible.length} commerce{visible.length > 1 ? "s" : ""} trouvé
            {visible.length > 1 ? "s" : ""}
          </span>
          <button
            type="button"
            onClick={reset}
            className="text-primary-700 font-medium hover:underline"
          >
            Effacer les filtres
          </button>
        </div>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* Grille                                                               */}
      {/* ------------------------------------------------------------------- */}
      {visible.length === 0 ? (
        <div className="border-border bg-surface text-muted rounded-[16px] border px-6 py-12 text-center text-sm">
          {hasActiveFilter ? (
            <>
              Aucun commerce ne correspond à ta recherche.
              <p className="mt-3">
                <button
                  type="button"
                  onClick={reset}
                  className="text-primary-700 font-medium hover:underline"
                >
                  Effacer les filtres →
                </button>
              </p>
            </>
          ) : (
            <>
              <MapPin className="text-subtle mx-auto mb-2 size-6" />
              Aucun commerce actif disponible pour le moment.
            </>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
          {visible.map((m) => (
            <MerchantCard key={m.id} merchant={m} />
          ))}
        </div>
      )}

      {/* ------------------------------------------------------------------- */}
      {/* Sheet/popover Filtres — bottom-sheet mobile, centré sur desktop.    */}
      {/* ------------------------------------------------------------------- */}
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
              pending={pending}
            />
          </div>
        </div>
      )}
    </div>
  );
}

// =============================================================================
// FilterSheet — sélecteurs catégorie / tri / ouvert maintenant.
// =============================================================================
function FilterSheet({
  filters,
  categories,
  onApply,
  onReset,
  onClose,
  pending,
}: {
  filters: Filters;
  categories: { name: string; count: number }[];
  onApply: (next: Filters) => void;
  onReset: () => void;
  onClose: () => void;
  pending: boolean;
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
        <Button
          type="button"
          onClick={() => onApply(draft)}
          className="flex-1"
          disabled={pending}
        >
          {pending && <Loader2 className="size-4 animate-spin" />}
          Appliquer
        </Button>
        <Button
          type="button"
          onClick={onReset}
          variant="outline"
          disabled={pending}
        >
          Effacer
        </Button>
      </div>
    </div>
  );
}

const SELECT =
  "border-border-strong bg-surface focus-visible:ring-primary-400/40 focus-visible:border-primary-400 h-10 w-full rounded-[10px] border px-3 text-sm focus-visible:ring-2 focus-visible:outline-none";
