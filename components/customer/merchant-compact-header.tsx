"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  MapPin,
  Search,
  ShoppingBasket,
  ShoppingCart,
  Timer,
  X,
} from "lucide-react";
import {
  useMerchantSearch,
  setSearchQuery,
  setSearchOpen,
} from "@/lib/customer/merchant-search-store";
import { cn } from "@/lib/utils";
import { cldUrl } from "@/lib/images/cloudinary";
import { categoryImageFor } from "@/lib/images/category-images";
import { getCategoryLabel } from "@/lib/config/categories";
import { getTagLabel } from "@/lib/config/merchant-tags";
import { isOpenNow, nowInAlgiers } from "@/lib/merchant/opening-hours";
import {
  computePauseState,
  type MerchantPauseInput,
} from "@/lib/merchant/pause-state";
import { MerchantReviewsDialog } from "@/components/customer/merchant-reviews-dialog";
import { FavoriteHeart } from "@/components/customer/favorite-heart";
import { ShareButton } from "@/components/customer/share-button";
import { totalUnits, useCart } from "@/lib/customer/cart-store";
import { DAY_KEYS, DAY_LABELS, type OpeningHours } from "@/lib/types";
import { formatDA } from "@/lib/utils";
import type { ReviewWithCustomer } from "@/lib/data/reviews";

// =============================================================================
// MerchantCompactHeader — en-tête fiche commerçant, refonte « ULTRA » immersive.
// =============================================================================
//   ┌───────────────────────────────────────────────┐
//   │  topbar fixe (← retour · ♡ · 🛒) translucide    │  ← devient verre dépoli
//   │  ┌─────────────────────────────────────────┐   │     + nom au scroll
//   │  │   COVER plein-cadre · dégradé sombre haut │   │
//   │  │   Nom de la boutique (posé sur la photo)  │   │
//   │  └─────────────────────────────────────────┘   │
//   └───────────────────────────────────────────────┘
//   [logo]   ●Ouvert   ★4.5 (28)            ← chevauche le bas du hero
//   Type · Commune, Wilaya                  ← zone blanche
//   ⏱ ~15 min · Min 500 DA · 📍Retrait gratuit · Horaires⌄
//   [ tags · description repliable · horaires repliables ]
//
// Le hero plonge sous l'encoche (env(safe-area-inset-top)) ; le dégradé sombre
// du haut garantit la lisibilité de la barre système et des boutons.
// =============================================================================

type Props = {
  merchantId: string;
  initialFavorite?: boolean;
  isAuth?: boolean;
  name: string;
  category: string | null;
  description_fr: string | null;
  description_ar: string | null;
  cover_url: string | null;
  logo_url: string | null;
  commune: string | null;
  wilaya_name: string | null;
  min_order_da: number;
  prep_time_min: number;
  opening_hours: OpeningHours;
  /** Pause / fermeture programmée — pour un statut « Ouvert/Fermé » cohérent
      avec l'acceptation réelle de commandes (et le bandeau « fermé »). */
  pause?: MerchantPauseInput;
  rating_avg: number;
  rating_count: number;
  reviews: ReviewWithCustomer[];
  /** Sous-spécialités (volet 1) — affichées en pilules. */
  tags?: string[];
};

export function MerchantCompactHeader({
  merchantId,
  initialFavorite = false,
  isAuth = false,
  name,
  category,
  description_fr,
  description_ar,
  cover_url,
  logo_url,
  commune,
  wilaya_name,
  min_order_da,
  prep_time_min,
  opening_hours,
  pause,
  rating_avg,
  rating_count,
  reviews,
  tags = [],
}: Props) {
  const t = useTranslations("merchant");
  const locale = useLocale();
  const [showHours, setShowHours] = useState(false);
  const [expandDesc, setExpandDesc] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const cart = useCart();
  const cartCount = totalUnits(cart);
  // Recherche intégrée au header (état partagé avec la barre du catalogue).
  const { open: searchOpen, query: searchQuery } = useMerchantSearch();

  // Statut d'ouverture (calculé à la volée, rafraîchi 1×/min pour suivre les
  // bascules de créneau) + jour courant pour surligner « Aujourd'hui ».
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);
  // « Ouvert » = horaires ouverts MAINTENANT *et* aucune pause / fermeture
  // programmée. Sinon « Fermé » → cohérent avec le bandeau « ce commerce est
  // fermé… » et avec l'acceptation réelle des commandes immédiates.
  const pauseState = computePauseState(
    pause ?? {
      orders_paused: null,
      paused_until: null,
      closure_start: null,
      closure_end: null,
    },
    now
  );
  // isOpenNow() SANS argument → utilise l'heure d'ALGÉRIE (comme le bandeau
  // « fermé »), pas l'heure locale de l'appareil — sinon incohérence de fuseau.
  const isOpen = isOpenNow(opening_hours) && !pauseState.closedNow;
  // Jour courant en heure d'Algérie (pour surligner « Aujourd'hui »).
  const todayKey = DAY_KEYS[(nowInAlgiers().getDay() + 6) % 7];

  // Topbar : transparente sur la photo, puis verre dépoli + nom dès qu'on
  // dépasse le hero (≈150 px). On écoute le scroll de la fenêtre.
  useEffect(() => {
    const onScroll = () => setScrolled(window.scrollY > 140);
    onScroll();
    window.addEventListener("scroll", onScroll, { passive: true });
    return () => window.removeEventListener("scroll", onScroll);
  }, []);

  const heroSrc = cover_url ?? categoryImageFor(category) ?? null;
  const heroOptimized = heroSrc
    ? (cldUrl(heroSrc, {
        width: 1200,
        height: 480,
        crop: "fill",
        gravity: "auto",
      }) ?? heroSrc)
    : null;
  const logoOptimized = cldUrl(logo_url, {
    width: 144,
    height: 144,
    crop: "fill",
    gravity: "auto",
  });
  const categoryLabel = category ? getCategoryLabel(category, locale) : null;
  const hasDescription = Boolean(description_fr || description_ar);
  const addressLine = [commune, wilaya_name].filter(Boolean).join(", ");

  // Bouton "verre" de la topbar : translucide sur la photo, plein au scroll.
  const rb = cn(
    "relative grid size-9 place-items-center rounded-full backdrop-blur transition-colors active:scale-90",
    scrolled || searchOpen
      ? "bg-surface-2 text-foreground hover:bg-surface-3"
      : "bg-white/15 text-white ring-1 ring-white/25 hover:bg-white/25"
  );

  return (
    <div>
      {/* ───── TOPBAR FIXE — toujours présente pour revenir / voir le panier.
              Translucide sur la photo, puis verre dépoli + nom au scroll. ───── */}
      <div
        className={cn(
          "fixed inset-x-0 top-0 z-40 pt-[env(safe-area-inset-top)] transition-[background-color,box-shadow]",
          scrolled || searchOpen
            ? "border-border border-b bg-white/85 shadow-sm backdrop-blur-xl"
            : "bg-transparent"
        )}
      >
        <div className="mx-auto flex h-14 max-w-[1100px] items-center gap-2 px-3 lg:px-4">
          {searchOpen ? (
            // ─── Mode RECHERCHE : barre intégrée au header, recherche en temps
            //     réel (état partagé avec le catalogue), sans remonter en haut.
            <>
              <button
                type="button"
                onClick={() => {
                  setSearchOpen(false);
                  setSearchQuery("");
                }}
                aria-label={t("back")}
                className={rb}
              >
                <ArrowLeft className="size-[18px] rtl:-scale-x-100" />
              </button>
              <div className="bg-surface-2 flex flex-1 items-center gap-2 rounded-full px-3.5 py-2">
                <Search className="text-muted size-4 shrink-0" />
                <input
                  autoFocus
                  type="search"
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  placeholder={t("searchProducts")}
                  className="placeholder:text-hint text-foreground w-full bg-transparent text-sm font-medium outline-none"
                />
                {searchQuery && (
                  <button
                    type="button"
                    onClick={() => setSearchQuery("")}
                    aria-label={t("clearSearch")}
                    className="text-muted hover:text-foreground shrink-0"
                  >
                    <X className="size-4" />
                  </button>
                )}
              </div>
            </>
          ) : (
            <>
              <Link href="/" aria-label={t("back")} className={rb}>
                <ArrowLeft className="size-[18px] rtl:-scale-x-100" />
              </Link>
              <h2
                className={cn(
                  "text-foreground min-w-0 flex-1 truncate text-base font-extrabold transition-opacity",
                  scrolled ? "opacity-100" : "opacity-0"
                )}
              >
                {name}
              </h2>
              {/* Icône RECHERCHE — apparaît au scroll. Clic → ouvre la barre de
              recherche INTÉGRÉE au header (recherche temps réel, sans remonter). */}
              {scrolled && (
                <button
                  type="button"
                  onClick={() => setSearchOpen(true)}
                  aria-label={t("searchProducts")}
                  className={cn(rb, "shrink-0")}
                >
                  <Search className="size-[18px]" />
                </button>
              )}
              <ShareButton
                title={name}
                label={t("share")}
                copiedMsg={t("linkCopied")}
                className={cn(rb, "shrink-0")}
              />
              <FavoriteHeart
                merchantId={merchantId}
                initialFavorite={initialFavorite}
                isAuth={isAuth}
                variant={scrolled ? "card" : "hero"}
                className={cn(
                  "size-9 shrink-0",
                  scrolled && "bg-surface-2 shadow-none"
                )}
              />
              <Link
                href="/cart"
                aria-label={t("viewMyCart")}
                className={cn(rb, "shrink-0")}
              >
                <ShoppingCart className="size-[18px]" />
                {cartCount > 0 && (
                  <span className="bg-success-600 absolute -end-0.5 -top-0.5 grid h-4 min-w-[16px] place-items-center rounded-full border-2 border-white px-0.5 text-[9px] font-extrabold text-white">
                    {cartCount}
                  </span>
                )}
              </Link>
            </>
          )}
        </div>
      </div>

      {/* ───── HERO immersif plein-cadre (plonge sous l'encoche). Hauteur
              RÉDUITE pour rapprocher les produits (fiche plus compacte). ───── */}
      <div className="bg-surface-3 relative -mx-4 -mt-4 h-[132px] w-[calc(100%+2rem)] overflow-hidden lg:-mx-6 lg:-mt-6 lg:h-[176px] lg:w-[calc(100%+3rem)]">
        {heroOptimized ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={heroOptimized}
            alt={t("merchantPhotoAlt", { name })}
            className="h-full w-full object-cover"
          />
        ) : (
          <div className="from-primary-500/25 to-primary-700/35 flex h-full w-full items-center justify-center bg-gradient-to-br">
            <span className="text-primary-700/70 text-6xl font-bold">
              {name.charAt(0)}
            </span>
          </div>
        )}
        {/* Dégradé : sombre en haut (barre système + topbar) puis fondu vers le
            fond clair de la page en bas (la couverture se fond dans le blanc). */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, rgba(8,8,18,.58) 0%, rgba(8,8,18,.12) 20%, transparent 44%, rgba(8,8,18,.30) 70%, rgba(8,8,18,.20) 88%, #f7f7fb 100%)",
          }}
        />
      </div>

      {/* ───── AVATAR + COLONNE (NOM, puis CATÉGORIE grise + NOTE ★ à droite),
              placés ENTIÈREMENT sous la couverture, dans la zone BLANCHE : le nom
              est donc toujours noir sur blanc (lisible quelle que soit la photo de
              couverture, claire ou sombre). ───── */}
      <div className="relative z-[1] mt-2.5 flex items-center gap-3.5 lg:mt-3">
        {logoOptimized ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={logoOptimized}
            alt=""
            loading="eager"
            decoding="async"
            className="size-[68px] shrink-0 rounded-2xl bg-white object-cover shadow-[0_12px_30px_-10px_rgba(40,35,90,.5)] ring-[3px] ring-white lg:size-[76px]"
          />
        ) : (
          <div className="bg-primary-100 text-primary-700 flex size-[68px] shrink-0 items-center justify-center rounded-2xl text-2xl font-black shadow-[0_12px_30px_-10px_rgba(40,35,90,.5)] ring-[3px] ring-white lg:size-[76px]">
            {name.charAt(0)}
          </div>
        )}
        <div className="min-w-0 flex-1 pb-0.5">
          <h1 className="text-foreground text-xl leading-tight font-black tracking-tight text-pretty lg:text-2xl">
            {name}
          </h1>
          {/* Catégorie (gris clair) juste sous le nom + note à droite, même ligne. */}
          <div className="mt-1 flex items-start justify-between gap-2">
            <span className="text-muted min-w-0 truncate pt-0.5 text-[13px] font-medium">
              {categoryLabel}
            </span>
            <span className="shrink-0">
              <MerchantReviewsDialog
                ratingAvg={rating_avg}
                ratingCount={rating_count}
                reviews={reviews}
              />
            </span>
          </div>
        </div>
      </div>

      {/* ───── ADRESSE (à gauche) + STATUT d'ouverture CLIQUABLE (à droite),
              DIRECTEMENT sous la catégorie, même ligne. Statut = libellé
              « Ouvert maintenant » (VERT) / « Fermé » (ROUGE) ; un clic déplie le
              planning de la semaine (plus de bouton « Horaires » séparé). ───── */}
      <div className="mt-1.5 flex items-center justify-between gap-3">
        {addressLine ? (
          <p className="text-muted inline-flex min-w-0 items-center gap-1 truncate text-xs font-semibold">
            <MapPin className="size-3.5 shrink-0" />
            <span className="truncate">{addressLine}</span>
          </p>
        ) : (
          <span />
        )}
        <button
          type="button"
          onClick={() => setShowHours((v) => !v)}
          aria-expanded={showHours}
          className="inline-flex shrink-0 items-center gap-1.5 text-xs font-bold"
        >
          <span
            className={cn(
              "size-1.5 rounded-full",
              isOpen ? "bg-success-500" : "bg-rose-500"
            )}
          />
          <span className={isOpen ? "text-success-700" : "text-rose-600"}>
            {isOpen ? t("openNow") : t("closed")}
          </span>
          {showHours ? (
            <ChevronUp className="text-subtle size-3.5" />
          ) : (
            <ChevronDown className="text-subtle size-3.5" />
          )}
        </button>
      </div>

      {/* ───── 2 STATS CLAIRES, étalées : PRÉPARATION à gauche, PANIER MIN. à
              droite. Icône en pastille + valeur en gras + libellé gris dessous,
              pour bien comprendre d'un coup d'œil. ───── */}
      {(prep_time_min > 0 || min_order_da > 0) && (
        <div className="border-border mt-3 flex items-center justify-between gap-3 rounded-[14px] border bg-white px-3.5 py-2.5">
          {prep_time_min > 0 ? (
            <Stat
              icon={<Timer className="size-[18px]" />}
              value={`~${t("prepMinutes", { count: prep_time_min })}`}
              label={t("prepLabel")}
            />
          ) : (
            <span />
          )}
          {min_order_da > 0 && (
            <Stat
              icon={<ShoppingBasket className="size-[18px]" />}
              value={formatDA(min_order_da)}
              label={t("minBasketLabel")}
              alignEnd
            />
          )}
        </div>
      )}

      {/* Pilules de spécialités (tags) — situent l'offre d'un coup d'œil. */}
      {tags.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-1.5">
          {tags.slice(0, 6).map((code) => (
            <span
              key={code}
              className="bg-primary-50 text-primary-700 rounded-full px-2.5 py-0.5 text-[11px] font-bold"
            >
              {getTagLabel(code, locale)}
            </span>
          ))}
        </div>
      )}

      {/* Description repliable (1 ligne par défaut). */}
      {hasDescription && (
        <div className="mt-2">
          {description_fr && (
            <p
              className={cn(
                "text-foreground text-xs",
                !expandDesc && "line-clamp-1"
              )}
            >
              {description_fr}
            </p>
          )}
          {expandDesc && description_ar && (
            <p className="text-foreground mt-1 text-xs" dir="rtl">
              {description_ar}
            </p>
          )}
          {(description_fr && description_fr.length > 80) || description_ar ? (
            <button
              type="button"
              onClick={() => setExpandDesc((v) => !v)}
              className="text-primary-700 mt-0.5 text-[11px] font-medium hover:underline"
            >
              {expandDesc ? t("seeLess") : t("seeMore")}
            </button>
          ) : null}
        </div>
      )}

      {/* Planning de la semaine (replié par défaut). AUJOURD'HUI est surligné
          avec un badge + son statut Ouvert/Fermé ; les autres jours suivent. */}
      {showHours && (
        <ul className="border-border bg-surface-2 mt-3 grid gap-0.5 rounded-[12px] border p-2 sm:grid-cols-2">
          {DAY_KEYS.map((d) => {
            const slots = opening_hours[d] ?? [];
            const isToday = d === todayKey;
            return (
              <li
                key={d}
                className={cn(
                  "flex items-center justify-between gap-2 rounded-md px-2 py-1.5 text-xs",
                  isToday ? "bg-primary-50 text-foreground" : "text-foreground"
                )}
              >
                <span className="inline-flex items-center gap-1.5 font-medium">
                  {DAY_LABELS[d].long}
                  {isToday && (
                    <span
                      className={cn(
                        "rounded-full px-1.5 py-px text-[9px] font-extrabold",
                        isOpen
                          ? "bg-success-100 text-success-700"
                          : "bg-stone-200 text-stone-600"
                      )}
                    >
                      {t("today")} · {isOpen ? t("openNow") : t("closed")}
                    </span>
                  )}
                </span>
                <span
                  className={cn(
                    "tabular-nums",
                    isToday ? "text-foreground font-bold" : "text-muted"
                  )}
                >
                  {slots.length === 0
                    ? t("closed")
                    : slots.map((s) => `${s.open}–${s.close}`).join(" · ")}
                </span>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

/**
 * Stat illustrée : icône en pastille + valeur en gras + libellé gris en dessous.
 * `alignEnd` (stat de droite) : icône à droite, texte aligné à droite, pour un
 * rendu symétrique « une à gauche / une à droite ».
 */
function Stat({
  icon,
  value,
  label,
  alignEnd = false,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
  alignEnd?: boolean;
}) {
  return (
    <div
      className={cn(
        "inline-flex min-w-0 items-center gap-2.5",
        alignEnd && "flex-row-reverse text-right"
      )}
    >
      <span className="bg-primary-50 text-primary-600 grid size-9 shrink-0 place-items-center rounded-full">
        {icon}
      </span>
      <span className="min-w-0 leading-tight">
        <span className="text-foreground block truncate text-sm font-extrabold tabular-nums">
          {value}
        </span>
        <span className="text-muted block truncate text-[11px] font-medium">
          {label}
        </span>
      </span>
    </div>
  );
}
