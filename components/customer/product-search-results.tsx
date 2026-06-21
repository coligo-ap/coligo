"use client";

import { useEffect, useMemo, useRef, useState, useTransition } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useFilterParams } from "@/lib/customer/marketplace-filters";
import { ArrowRight, Check, Loader2, Plus, Search, Star } from "lucide-react";
import { cn, formatDA } from "@/lib/utils";
import { cldUrl } from "@/lib/images/cloudinary";
import { isOpenNow } from "@/lib/merchant/opening-hours";
import { computePauseState } from "@/lib/merchant/pause-state";
import { haversineKm } from "@/lib/delivery/distance";
import { useCustomerLocation } from "@/lib/customer/location-store";
import { useCartAdd } from "@/components/customer/cart-mono-provider";
import { searchProducts } from "@/app/(customer)/actions";
import type {
  ProductSearchGroup,
  SearchProduct,
} from "@/lib/data/product-search";

// =============================================================================
// Résultats de RECHERCHE PRODUIT (volet 2) — style maquette « carrousel ».
// Chaque commerçant = un bloc-conteneur (logo rond + en-tête) qui regroupe ses
// produits trouvés dans un carrousel horizontal (scroll-snap). Classement :
// commerçants ACTIONNABLES en haut (tri par pilule), fermés en bas grisés.
// =============================================================================

type SortKey = "relevant" | "cheap" | "near" | "rated";

type EnrichedGroup = ProductSearchGroup & {
  open: boolean;
  distanceKm: number | null;
};

export function ProductSearchResults() {
  const t = useTranslations("productSearch");
  const params = useFilterParams();
  const loc = useCustomerLocation();
  const q = (params.get("q") ?? "").trim();

  const [groups, setGroups] = useState<ProductSearchGroup[]>([]);
  const [sort, setSort] = useState<SortKey>("relevant");
  const [pending, startTransition] = useTransition();

  useEffect(() => {
    if (q.length < 2) {
      setGroups([]);
      return;
    }
    startTransition(async () => {
      const res = await searchProducts({
        q,
        wilaya_code: loc?.wilaya_code ?? null,
        commune: loc?.commune ?? null,
      });
      setGroups(res.groups);
    });
  }, [q, loc?.wilaya_code, loc?.commune]);

  // Distance client → commerce (km) si position connue.
  const distanceFor = useMemo(() => {
    const lat = loc?.latitude;
    const lng = loc?.longitude;
    return (lat2: number | null, lng2: number | null): number | null => {
      if (lat == null || lng == null || lat2 == null || lng2 == null)
        return null;
      return haversineKm({ lat, lng }, { lat: lat2, lng: lng2 });
    };
  }, [loc?.latitude, loc?.longitude]);

  // Filtre dur (fermé / en pause) + enrichissement distance.
  const enriched = useMemo<EnrichedGroup[]>(() => {
    return groups.map((g) => {
      const m = g.merchant;
      const paused = computePauseState({
        orders_paused: m.orders_paused,
        paused_until: m.paused_until,
        closure_start: m.closure_start,
        closure_end: m.closure_end,
      }).closedNow;
      const open = !paused && isOpenNow(m.opening_hours);
      return {
        ...g,
        open,
        distanceKm: distanceFor(m.latitude, m.longitude),
      };
    });
  }, [groups, distanceFor]);

  const openGroups = useMemo(() => {
    const list = enriched.filter((g) => g.open);
    const sorted = [...list];
    if (sort === "cheap") {
      sorted.sort(
        (a, b) => (a.cheapestDa ?? Infinity) - (b.cheapestDa ?? Infinity)
      );
    } else if (sort === "near") {
      sorted.sort(
        (a, b) => (a.distanceKm ?? Infinity) - (b.distanceKm ?? Infinity)
      );
    } else if (sort === "rated") {
      sorted.sort((a, b) => b.merchant.rating_avg - a.merchant.rating_avg);
    } else {
      sorted.sort((a, b) => b.relevance - a.relevance);
    }
    return sorted;
  }, [enriched, sort]);

  const closedGroups = useMemo(
    () => enriched.filter((g) => !g.open),
    [enriched]
  );

  // Prix plancher parmi les ouverts → badge « Moins cher ».
  const minCheap = useMemo(() => {
    let min = Infinity;
    for (const g of openGroups)
      if (g.cheapestDa != null) min = Math.min(min, g.cheapestDa);
    return min === Infinity ? null : min;
  }, [openGroups]);

  if (q.length < 2) return null;

  const total = enriched.length;

  return (
    <div data-checkout className="space-y-1">
      {/* En-tête résultats. */}
      <div className="flex items-end justify-between gap-3">
        <div>
          <h2 className="text-foreground text-[21px] font-extrabold tracking-[-0.6px]">
            « {q} »
          </h2>
          <p className="text-muted mt-0.5 text-[12.5px] font-semibold">
            {pending && total === 0 ? (
              t("searching")
            ) : (
              <>
                <span className="text-primary-700 font-extrabold">
                  {t("nMerchants", { count: total })}
                </span>{" "}
                {t("haveItNearYou")}
              </>
            )}
          </p>
        </div>
        {pending && <Loader2 className="text-muted size-4 animate-spin" />}
      </div>

      {/* Pilules de tri. */}
      <div className="scrollbar-hide -mx-1 flex gap-2 overflow-x-auto px-1 py-2">
        {(
          [
            ["relevant", t("sortRelevant")],
            ["cheap", t("sortCheap")],
            ["near", t("sortNear")],
            ["rated", t("sortRated")],
          ] as [SortKey, string][]
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setSort(key)}
            className={cn(
              "shrink-0 rounded-full border px-3.5 py-2 text-[12.5px] font-bold transition active:scale-95",
              sort === key
                ? "border-foreground bg-foreground text-white"
                : "border-border bg-surface text-foreground hover:border-primary-300"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Aucun résultat. */}
      {!pending && total === 0 && (
        <div className="border-border bg-surface text-muted mt-2 rounded-[18px] border px-6 py-12 text-center text-sm">
          <Search className="text-subtle mx-auto mb-2 size-6" />
          {t("empty", { q })}
        </div>
      )}

      {/* Commerçants actionnables + carrousels. */}
      {openGroups.map((g) => (
        <MerchantGroup
          key={g.merchant.id}
          group={g}
          query={q}
          cheapest={minCheap != null && g.cheapestDa === minCheap}
        />
      ))}

      {/* Fermés pour le moment (grisés, en bas). */}
      {closedGroups.length > 0 && (
        <>
          <p className="text-subtle mt-4 px-1 pb-1 text-[11px] font-extrabold tracking-wider uppercase">
            {t("closedSection")}
          </p>
          {closedGroups.map((g) => (
            <MerchantGroup
              key={g.merchant.id}
              group={g}
              query={q}
              cheapest={false}
              closed
            />
          ))}
        </>
      )}
    </div>
  );
}

function MerchantGroup({
  group,
  query,
  cheapest,
  closed = false,
}: {
  group: EnrichedGroup;
  query: string;
  cheapest: boolean;
  closed?: boolean;
}) {
  const t = useTranslations("productSearch");
  const m = group.merchant;

  // Badge dérivé du score : « Moins cher » (prix plancher) prioritaire, sinon
  // « Rapide » si le score de rapidité MESURÉ est élevé (volet 3).
  const badge: { label: string; tone: "fast" | "cheap" } | null = closed
    ? null
    : cheapest
      ? { label: t("badgeCheap"), tone: "cheap" }
      : m.score_speed >= 0.7
        ? { label: t("badgeFast"), tone: "fast" }
        : null;

  const metaBits: string[] = [];
  if (m.prep_time_min > 0) metaBits.push(`${m.prep_time_min} min`);
  if (group.distanceKm != null)
    metaBits.push(`${group.distanceKm.toFixed(1)} km`);

  return (
    <section
      className={cn(
        "bg-surface co-rise mt-3 overflow-hidden rounded-[22px] border shadow-[0_1px_2px_rgba(20,20,50,0.04),0_10px_26px_-14px_rgba(40,35,90,0.22)]",
        closed ? "border-border opacity-60" : "border-border"
      )}
    >
      {/* En-tête commerçant — logo ROND (identité). */}
      <Link
        href={`/m/${m.slug}`}
        className="border-border flex items-center gap-3 border-b px-4 py-3.5"
      >
        <span
          className="bg-surface-2 size-[46px] shrink-0 rounded-full border-[2.5px] border-white bg-cover bg-center shadow-[0_3px_8px_-3px_rgba(0,0,0,0.25)] ring-1 ring-[var(--color-border)]"
          style={{
            backgroundImage: m.logo_url
              ? `url('${cldUrl(m.logo_url, { width: 120, height: 120, crop: "fill" }) ?? m.logo_url}')`
              : undefined,
          }}
        />
        <span className="min-w-0 flex-1">
          <span className="text-foreground block truncate text-[15.5px] font-extrabold tracking-[-0.3px]">
            {m.name}
          </span>
          <span className="text-muted mt-0.5 flex flex-wrap items-center gap-1.5 text-[11.5px] font-bold">
            {m.rating_count > 0 && (
              <span className="text-foreground flex items-center gap-0.5">
                <Star className="size-3 fill-[#FFB02E] text-[#FFB02E]" />
                {m.rating_avg.toFixed(1)}
              </span>
            )}
            {!closed ? (
              <>
                {m.rating_count > 0 && <Dot />}
                <span className="text-success-600">● {t("open")}</span>
              </>
            ) : (
              <>
                {m.rating_count > 0 && <Dot />}
                <span className="text-muted">{t("closedShort")}</span>
              </>
            )}
            {metaBits.length > 0 && !closed && (
              <>
                <Dot />
                <span className="text-muted">{metaBits.join(" · ")}</span>
              </>
            )}
          </span>
        </span>
        {badge ? (
          <span
            className={cn(
              "shrink-0 rounded-full px-2.5 py-1 text-[10px] font-extrabold",
              badge.tone === "fast"
                ? "bg-primary-50 text-primary-700"
                : "bg-success-50 text-success-700"
            )}
          >
            {badge.label}
          </span>
        ) : closed ? (
          <span className="bg-surface-2 text-muted shrink-0 rounded-full px-2.5 py-1 text-[10px] font-extrabold">
            {t("closedShort")}
          </span>
        ) : (
          <span className="bg-primary-50 text-primary-600 grid size-[30px] shrink-0 place-items-center rounded-full">
            <ArrowRight className="size-4 rtl:-scale-x-100" />
          </span>
        )}
      </Link>

      {/* Carrousel produits (masqué pour un commerce fermé). */}
      {!closed && group.products.length > 0 && (
        <>
          <div className="text-foreground flex items-center gap-1.5 px-4 pt-3 pb-2 text-[11.5px] font-extrabold">
            <span className="capitalize">{query}</span>
            <span className="text-primary-600">
              · {t("nProducts", { count: group.products.length })}
            </span>
          </div>
          <div className="scrollbar-hide flex snap-x snap-mandatory gap-3 overflow-x-auto px-4 pb-4">
            {group.products.map((p) => (
              <ProductCard key={p.id} product={p} merchant={m} />
            ))}
          </div>
        </>
      )}
    </section>
  );
}

function Dot() {
  return <span className="bg-subtle inline-block size-[3px] rounded-full" />;
}

function ProductCard({
  product,
  merchant,
}: {
  product: SearchProduct;
  merchant: ProductSearchGroup["merchant"];
}) {
  const { requestAdd } = useCartAdd();
  const [added, setAdded] = useState(false);
  const flashRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const out =
    product.is_available === false ||
    (product.stock_qty != null && product.stock_qty <= 0);

  function add(e: React.MouseEvent) {
    e.preventDefault();
    e.stopPropagation();
    if (out) return;
    const addedNow = requestAdd(merchant, {
      product_id: product.id,
      name: product.name_fr,
      unit_price_da: product.price_da,
      image_url: product.image_url,
    });
    if (addedNow) {
      setAdded(true);
      if (flashRef.current) clearTimeout(flashRef.current);
      flashRef.current = setTimeout(() => setAdded(false), 500);
    }
  }

  return (
    <Link
      href={`/m/${merchant.slug}`}
      className="bg-surface-2 border-border w-[144px] shrink-0 snap-start overflow-hidden rounded-[16px] border shadow-[0_2px_6px_-2px_rgba(40,35,90,0.12)] transition active:scale-[0.97]"
    >
      <div className="relative h-[104px] w-full overflow-hidden">
        {product.image_url ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={
              cldUrl(product.image_url, {
                width: 320,
                height: 240,
                crop: "fill",
                gravity: "auto",
              }) ?? product.image_url
            }
            alt=""
            loading="lazy"
            decoding="async"
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="from-primary-500/10 to-surface-3 h-full w-full bg-gradient-to-br" />
        )}
        <button
          type="button"
          onClick={add}
          disabled={out}
          aria-label="+"
          className={cn(
            "absolute right-2 bottom-2 grid size-8 place-items-center rounded-full shadow-[0_3px_10px_rgba(0,0,0,0.25)] transition active:scale-90",
            out
              ? "bg-surface-3 text-subtle cursor-not-allowed"
              : added
                ? "bg-success-600 text-white"
                : "text-primary-600 bg-white"
          )}
        >
          {added ? <Check className="size-4" /> : <Plus className="size-4" />}
        </button>
      </div>
      <div className="px-2.5 pt-2.5 pb-3">
        <p className="text-foreground line-clamp-2 h-8 text-[13px] leading-tight font-semibold tracking-[-0.2px]">
          {product.name_fr}
        </p>
        <p className="text-primary-700 mt-1.5 text-[15px] font-extrabold tabular-nums">
          {formatDA(product.price_da)}
        </p>
      </div>
    </Link>
  );
}
