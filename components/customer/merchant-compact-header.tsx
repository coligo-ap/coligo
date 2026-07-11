"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  ArrowLeft,
  ChevronDown,
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
import { categoryLabelFrom, useCategories } from "@/lib/hooks/use-categories";
import { getTagLabel } from "@/lib/config/merchant-tags";
import { isOpenNow, nowInAlgiers } from "@/lib/merchant/opening-hours";
import {
  computePauseState,
  type MerchantPauseInput,
} from "@/lib/merchant/pause-state";
import { Portal } from "@/components/ui/portal";
import { MerchantReviewsDialog } from "@/components/customer/merchant-reviews-dialog";
import { FavoriteHeart } from "@/components/customer/favorite-heart";
import { ShareButton } from "@/components/customer/share-button";
import { totalUnits, useCart } from "@/lib/customer/cart-store";
import { logMerchantEvent } from "@/lib/customer/reco-events";
import { DAY_KEYS, dayLongLabel, type OpeningHours } from "@/lib/types";
import { formatDA } from "@/lib/utils";
import type { ReviewWithCustomer } from "@/lib/data/reviews";

// =============================================================================
// MerchantCompactHeader — en-tête fiche commerçant, refonte « ULTRA » immersive.
// =============================================================================
//   ┌───────────────────────────────────────────────┐
//   │  topbar fixe (← · partager · 🛒) translucide    │  ← au scroll : verre
//   │  ┌─────────────────────────────────────────┐   │     dépoli + BARRE DE
//   │  │   COVER plein-cadre · dégradé sombre haut │   │     RECHERCHE inline
//   │  └─────────────────────────────────────────┘   │     (saisie directe)
//   └───────────────────────────────────────────────┘
//   [logo]  Nom de la boutique                    ♡   ← ♡ sur la ligne du nom
//           Type                          ★4.5 (28)
//   [ ●Ouvert⌄ │ ⏱~15 min │ 🧺 500 DA │ 📍Commune ]     ← bande d'infos unifiée
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
  // Libellés de catégorie pilotés en base (renommages admin répercutés).
  const dbCategories = useCategories();
  const [showHours, setShowHours] = useState(false);
  const [expandDesc, setExpandDesc] = useState(false);
  const [scrolled, setScrolled] = useState(false);
  const cart = useCart();
  const cartCount = totalUnits(cart);
  // Recherche intégrée au header — SEULE barre de recherche de la fiche
  // (état partagé : le catalogue lit `query` pour filtrer).
  const { open: searchOpen, query: searchQuery } = useMerchantSearch();

  // Statut d'ouverture (calculé à la volée, rafraîchi 1×/min pour suivre les
  // bascules de créneau) + jour courant pour surligner « Aujourd'hui ».
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    const id = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(id);
  }, []);

  // Événement de RECO « vue de vitrine » (phase 5) — 1× par montage,
  // best-effort et jamais bloquant. Complète l'entonnoir clic → vue →
  // commande pour l'apprentissage des pondérations.
  useEffect(() => {
    logMerchantEvent(merchantId, "view");
  }, [merchantId]);
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
  // QUALITÉ COUVERTURE : le crop Cloudinary doit épouser le RATIO RÉEL du
  // bandeau (≈3:1 mobile, ≈6:1 desktop). Avant : crop 2,5:1 re-recadré par
  // object-cover → zoom navigateur + perte de netteté. Ici on demande deux
  // variantes au bon ratio, en 2–3× DPR (jamais d'upscale : gravity auto
  // choisit la meilleure bande de la photo, le navigateur n'agrandit rien).
  const heroMobile = heroSrc
    ? (cldUrl(heroSrc, {
        width: 1200,
        height: 408,
        crop: "fill",
        gravity: "auto",
      }) ?? heroSrc)
    : null;
  const heroDesktop = heroSrc
    ? (cldUrl(heroSrc, {
        width: 2200,
        height: 352,
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
  const categoryLabel = category
    ? categoryLabelFrom(dbCategories, category, locale)
    : null;
  const hasDescription = Boolean(description_fr || description_ar);
  const addressLine = [commune, wilaya_name].filter(Boolean).join(", ");

  // Barre de recherche visible : ouverte manuellement (icône) OU au scroll.
  const showSearchBar = scrolled || searchOpen;

  // Bouton "verre" de la topbar : translucide sur la photo, plein au scroll.
  const rb = cn(
    "relative grid size-9 place-items-center rounded-full backdrop-blur transition-colors active:scale-90",
    showSearchBar
      ? "bg-surface-2 text-foreground hover:bg-surface-3"
      : "bg-white/15 text-white ring-1 ring-white/25 hover:bg-white/25"
  );

  return (
    <div>
      {/* ───── TOPBAR FIXE — LA seule barre de recherche de la fiche (aucun
              doublon dans le corps de page) : icône 🔍 sur la photo → s'ouvre
              en barre à saisie directe (verre dépoli) ; au scroll, la barre est
              affichée en permanence, pleine largeur. ───── */}
      <div
        className={cn(
          "fixed inset-x-0 top-0 z-40 pt-[env(safe-area-inset-top)] transition-[background-color,box-shadow]",
          showSearchBar
            ? "border-border border-b bg-white/85 shadow-sm backdrop-blur-xl"
            : "bg-transparent"
        )}
      >
        <div className="mx-auto flex h-14 max-w-[1100px] items-center gap-2 px-3 lg:px-4">
          {/* ← : referme la recherche si elle a été ouverte depuis la photo,
              sinon revient à l'accueil. */}
          {searchOpen && !scrolled ? (
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
          ) : (
            <Link href="/" aria-label={t("back")} className={rb}>
              <ArrowLeft className="size-[18px] rtl:-scale-x-100" />
            </Link>
          )}

          {showSearchBar ? (
            /* Recherche INLINE temps réel (état partagé avec le catalogue) —
               le client tape directement, les résultats filtrent en dessous. */
            <div className="bg-surface-2 flex h-9 min-w-0 flex-1 items-center gap-2 rounded-full px-3.5">
              <Search className="text-muted size-4 shrink-0" />
              <input
                type="search"
                autoFocus={searchOpen && !scrolled}
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                placeholder={t("searchProducts")}
                className="placeholder:text-hint text-foreground w-full min-w-0 bg-transparent text-sm font-medium outline-none"
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
          ) : (
            <>
              <span className="min-w-0 flex-1" />
              <button
                type="button"
                onClick={() => setSearchOpen(true)}
                aria-label={t("searchProducts")}
                className={cn(rb, "shrink-0")}
              >
                <Search className="size-[18px]" />
              </button>
              <ShareButton
                title={name}
                label={t("share")}
                copiedMsg={t("linkCopied")}
                className={cn(rb, "shrink-0")}
              />
            </>
          )}

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
        </div>
      </div>

      {/* ───── HERO immersif plein-cadre (plonge sous l'encoche). Hauteur
              RÉDUITE pour rapprocher les produits (fiche plus compacte). ───── */}
      <div className="bg-surface-3 relative -mx-4 -mt-4 h-[132px] w-[calc(100%+2rem)] overflow-hidden lg:-mx-6 lg:-mt-6 lg:h-[176px] lg:w-[calc(100%+3rem)]">
        {heroMobile ? (
          <picture>
            {heroDesktop && (
              <source media="(min-width: 1024px)" srcSet={heroDesktop} />
            )}
            <img
              src={heroMobile}
              alt={t("merchantPhotoAlt", { name })}
              className="h-full w-full object-cover"
            />
          </picture>
        ) : (
          <div className="from-primary-500/25 to-primary-700/35 flex h-full w-full items-center justify-center bg-gradient-to-br">
            <span className="text-primary-700/70 text-6xl font-bold">
              {name.charAt(0)}
            </span>
          </div>
        )}
        {/* Photo de couverture PROPRE (style Bolt Food) : plus de voile sombre
            qui « efface » la photo. Seul un léger scrim tout en HAUT garantit la
            lisibilité des boutons ronds (retour/♡/panier) sur photo claire. */}
        <div
          className="pointer-events-none absolute inset-0"
          style={{
            background:
              "linear-gradient(180deg, rgba(0,0,0,.30) 0%, rgba(0,0,0,.06) 26%, transparent 40%)",
          }}
        />
      </div>

      {/* ───── AVATAR + COLONNE (NOM, puis CATÉGORIE grise + NOTE ★ à droite),
              placés ENTIÈREMENT sous la couverture, dans la zone BLANCHE : le nom
              est donc toujours noir sur blanc (lisible quelle que soit la photo de
              couverture, claire ou sombre). ───── */}
      {/* Feuille BLANCHE à coins arrondis qui CHEVAUCHE la couverture (style
          Bolt Food) : la photo reste pleine et propre, le contenu démarre sur
          une carte blanche nette. */}
      <div className="relative z-[1] -mx-4 -mt-5 flex items-center gap-3.5 rounded-t-[24px] bg-white px-4 pt-3.5 lg:-mx-6 lg:px-6">
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
          {/* NOM + ♡ FAVORI sur la MÊME ligne (cœur au coin, RTL-safe via flex). */}
          <div className="flex items-start justify-between gap-2">
            <h1 className="text-foreground min-w-0 text-xl leading-tight font-black tracking-tight text-pretty lg:text-2xl">
              {name}
            </h1>
            <FavoriteHeart
              merchantId={merchantId}
              initialFavorite={initialFavorite}
              isAuth={isAuth}
              variant="card"
              className="bg-surface-2 size-9 shrink-0 shadow-none"
            />
          </div>
          {/* Catégorie (gris clair) juste sous le nom + note à droite, même ligne. */}
          <div className="flex items-start justify-between gap-2">
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

      {/* ───── BANDE D'INFOS unifiée (une seule carte, cellules séparées par un
              filet, RTL-safe via border-inline-start) : statut Ouvert/Fermé
              (tap → horaires) · préparation · panier min · localisation.
              Remplace 3 blocs empilés → un seul coup d'œil, zéro doublon. ───── */}
      <div className="border-border [&>*+*]:border-border mt-3 flex [scrollbar-width:none] overflow-x-auto rounded-[14px] border bg-white [&::-webkit-scrollbar]:hidden [&>*+*]:border-s">
        <button
          type="button"
          onClick={() => setShowHours(true)}
          aria-expanded={showHours}
          className="hover:bg-surface-2 flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-2 py-2.5 transition-colors active:scale-[0.98]"
        >
          {/* Statut seul en haut (propre) ; l'affordance ⌄ est COLLÉE au
              libellé « Horaires » → on comprend que c'est LA carte horaires
              qui s'ouvre (pas le temps de préparation voisin). */}
          <span
            className={cn(
              "inline-flex items-center gap-1.5 text-[13px] font-extrabold",
              isOpen ? "text-success-700" : "text-rose-600"
            )}
          >
            <span
              className={cn(
                "size-1.5 rounded-full",
                isOpen ? "bg-success-500" : "bg-rose-500"
              )}
            />
            {isOpen ? t("openNow") : t("closed")}
          </span>
          <span className="text-primary-700 inline-flex items-center gap-0.5 text-[10.5px] font-bold">
            {t("hoursLabel")}
            <ChevronDown className="size-3" />
          </span>
        </button>
        {prep_time_min > 0 && (
          <InfoCell
            icon={<Timer className="size-3.5" />}
            value={`~${t("prepMinutes", { count: prep_time_min })}`}
            label={t("prepLabel")}
          />
        )}
        {min_order_da > 0 && (
          <InfoCell
            icon={<ShoppingBasket className="size-3.5" />}
            value={formatDA(min_order_da)}
            label={t("minBasketLabel")}
          />
        )}
        {addressLine && (
          <InfoCell
            icon={<MapPin className="size-3.5" />}
            value={commune ?? addressLine}
            label={wilaya_name ?? t("locationLabel")}
          />
        )}
      </div>

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

      {/* Planning de la semaine — POP-UP (feuille animée) au lieu d'un
          accordéon qui pousse toute la page. Aujourd'hui surligné + statut. */}
      {showHours && (
        <HoursSheet
          openingHours={opening_hours}
          todayKey={todayKey}
          isOpen={isOpen}
          name={name}
          addressLine={addressLine}
          onClose={() => setShowHours(false)}
        />
      )}
    </div>
  );
}

/** Pop-up des horaires : statut du moment, planning de la semaine (Aujourd'hui
 *  surligné), adresse en pied. Feuille bas-d'écran mobile / dialog desktop. */
function HoursSheet({
  openingHours,
  todayKey,
  isOpen,
  name,
  addressLine,
  onClose,
}: {
  openingHours: OpeningHours;
  todayKey: (typeof DAY_KEYS)[number];
  isOpen: boolean;
  name: string;
  addressLine: string;
  onClose: () => void;
}) {
  const t = useTranslations("merchant");
  const locale = useLocale();
  return (
    <Portal>
      <div
        className="partner-overlay-in fixed inset-0 z-[100] flex items-end justify-center bg-black/50 p-0 backdrop-blur-[2px] sm:items-center sm:p-4"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div
          className="bg-surface partner-sheet-in flex max-h-[85vh] w-full max-w-md flex-col rounded-t-[24px] pb-[env(safe-area-inset-bottom)] shadow-xl sm:rounded-[24px]"
          role="dialog"
          aria-modal="true"
        >
          {/* Poignée (standard bottom-sheet) */}
          <div
            className="flex justify-center pt-2.5 pb-1 sm:hidden"
            aria-hidden
          >
            <span className="bg-border-strong h-1 w-10 rounded-full" />
          </div>

          <header className="flex items-start justify-between gap-3 px-5 pt-2 pb-3 sm:pt-5">
            <div className="min-w-0">
              <h2 className="font-display text-foreground truncate text-lg font-bold">
                {t("hoursLabel")}
              </h2>
              <p
                className={cn(
                  "mt-0.5 inline-flex items-center gap-1.5 text-[13px] font-extrabold",
                  isOpen ? "text-success-700" : "text-rose-600"
                )}
              >
                <span
                  className={cn(
                    "size-1.5 rounded-full",
                    isOpen ? "bg-success-500" : "bg-rose-500"
                  )}
                />
                {isOpen ? t("openNow") : t("closed")}
                <span className="text-muted font-medium">· {name}</span>
              </p>
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label={t("close")}
              className="text-muted hover:bg-surface-2 mt-0.5 shrink-0 rounded-full p-1.5"
            >
              <X className="size-5" />
            </button>
          </header>

          <div className="overflow-y-auto px-5 pb-5">
            <ul className="border-border divide-border divide-y rounded-[14px] border">
              {DAY_KEYS.map((d) => {
                const slots = openingHours[d] ?? [];
                const isToday = d === todayKey;
                return (
                  <li
                    key={d}
                    className={cn(
                      "flex items-center justify-between gap-2 px-3.5 py-2.5 text-[13px] first:rounded-t-[13px] last:rounded-b-[13px]",
                      isToday && "bg-primary-50"
                    )}
                  >
                    <span className="inline-flex items-center gap-1.5 font-semibold">
                      {dayLongLabel(d, locale)}
                      {isToday && (
                        <span
                          className={cn(
                            "rounded-full px-1.5 py-px text-[9px] font-extrabold",
                            isOpen
                              ? "bg-success-100 text-success-700"
                              : "bg-stone-200 text-stone-600"
                          )}
                        >
                          {t("today")}
                        </span>
                      )}
                    </span>
                    <span
                      className={cn(
                        "text-end tabular-nums",
                        isToday
                          ? "text-foreground font-bold"
                          : slots.length === 0
                            ? "font-medium text-rose-500"
                            : "text-muted"
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

            {/* Localisation — l'info complémentaire utile au même endroit. */}
            {addressLine && (
              <p className="text-muted mt-3 flex items-center gap-1.5 text-[12.5px] font-semibold">
                <MapPin className="text-primary-600 size-4 shrink-0" />
                {addressLine}
              </p>
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
}

/** Cellule de la bande d'infos : valeur en gras (avec petite icône) + libellé
 *  gris dessous. Centrée, compacte, tronquée proprement. */
function InfoCell({
  icon,
  value,
  label,
}: {
  icon: React.ReactNode;
  value: string;
  label: string;
}) {
  return (
    <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 px-2 py-2.5 text-center">
      <span className="text-foreground inline-flex max-w-full items-center gap-1 text-[13px] font-extrabold tabular-nums">
        <span className="text-primary-600 shrink-0">{icon}</span>
        <span className="truncate">{value}</span>
      </span>
      <span className="text-muted max-w-full truncate text-[10.5px] font-medium">
        {label}
      </span>
    </div>
  );
}
