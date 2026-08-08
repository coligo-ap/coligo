"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  ArrowLeft,
  ChevronDown,
  MapPin,
  Phone,
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
import { MerchantMapCard } from "@/components/customer/merchant-map-card";
import { BarcodeScanButton } from "@/components/customer/barcode-scan-button";
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
  /** Scan code-barres dans la recherche (flag `barcode_merchant`, serveur). */
  barcode_scan_enabled?: boolean;
  /** « Plus d'infos » façon Bolt : services, carte + itinéraire, contact. */
  phone_public?: string | null;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  delivery_enabled?: boolean;
  express_enabled?: boolean;
  tours_enabled?: boolean;
  accepts_cash?: boolean;
  accepts_online?: boolean;
  delivery_radius_km?: number | null;
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
  barcode_scan_enabled = false,
  phone_public = null,
  address = null,
  latitude = null,
  longitude = null,
  delivery_enabled = false,
  express_enabled = false,
  tours_enabled = false,
  accepts_cash = true,
  accepts_online = false,
  delivery_radius_km = null,
}: Props) {
  const t = useTranslations("merchant");
  const locale = useLocale();
  // Libellés de catégorie pilotés en base (renommages admin répercutés).
  const dbCategories = useCategories();
  const [showHours, setShowHours] = useState(false);
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
  // Créneaux DU JOUR — résumé « Ouvert maintenant · 08:00–15:00, 18:00–00:00 »
  // (chip de la fiche + 1re ligne de « Plus d'infos », façon Bolt).
  const todaySlots = opening_hours[todayKey] ?? [];
  const todayLabel = todaySlots.map((s) => `${s.open}–${s.close}`).join(", ");

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
              {barcode_scan_enabled && (
                <BarcodeScanButton
                  surface="merchant"
                  merchantId={merchantId}
                  onFound={(name) => {
                    setSearchOpen(true);
                    setSearchQuery(name);
                  }}
                />
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
              <span className="bg-success-600 text-nano absolute -end-0.5 -top-0.5 grid h-4 min-w-[16px] place-items-center rounded-full border-2 border-white px-0.5 font-extrabold text-white">
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
        {/* Statut d'ouverture SUR la couverture (côté start — le centre est
            occupé par le logo à cheval) : fond VERT BOLT (#2B8659, échantillonné
            sur leur CTA réel), texte BLANC « Ouvert maintenant ». Fermé → fond
            rose, « Fermé ». Tap → Plus d'infos (horaires complets).
            ⚠️ max-w = 50 % − demi-logo (44 px, anneau compris) − 12 px d'ÉCART
            VISIBLE : la pastille ne touche JAMAIS le logo centré. Padding
            serré (règle produit : pas d'air superflu texte ↔ carte). */}
        <button
          type="button"
          onClick={() => setShowHours(true)}
          className={cn(
            "text-label absolute start-3 bottom-8 z-[2] inline-flex max-w-[calc(50%-56px)] items-center gap-1 rounded-full px-2.5 py-1 font-extrabold text-white shadow-[0_4px_14px_-4px_rgba(0,0,0,.35)] transition-transform active:scale-[0.96] lg:start-5",
            isOpen ? "bg-[#2B8659]" : "bg-rose-600"
          )}
        >
          <span className="size-1.5 shrink-0 rounded-full bg-white" />
          {/* Libellé COURT (« Ouvert ») : « Ouvert maintenant » ne tient pas à
              côté du logo centré sur 390 px sans le toucher ni se tronquer —
              le libellé complet vit dans Plus d'infos. */}
          <span className="truncate">
            {isOpen ? t("openShort") : t("closedShort")}
          </span>
        </button>
      </div>

      {/* ───── EN-TÊTE CENTRÉ façon Bolt Food Market : feuille BLANCHE à coins
              arrondis qui chevauche la couverture, LOGO centré À CHEVAL entre
              la photo et la feuille, NOM centré, « Plus d'infos » juste
              dessous. Le ♡ favori reste accessible au coin de la feuille. ───── */}
      <div className="rounded-t-panel relative z-[1] -mx-4 -mt-5 bg-white px-4 pt-2 lg:-mx-6 lg:px-6">
        {/* LOGO centré, moitié sur la couverture / moitié sur la feuille. */}
        <div className="pointer-events-none absolute inset-x-0 -top-9 flex justify-center lg:-top-10">
          {logoOptimized ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={logoOptimized}
              alt=""
              loading="eager"
              decoding="async"
              className="size-[72px] rounded-2xl bg-white object-cover ring-4 ring-white lg:size-[80px]"
            />
          ) : (
            <div className="bg-primary-100 text-primary-700 flex size-[72px] items-center justify-center rounded-2xl text-2xl font-black ring-4 ring-white lg:size-[80px]">
              {name.charAt(0)}
            </div>
          )}
        </div>

        {/* ♡ favori au coin de la feuille (n'empiète pas sur le nom centré). */}
        <div className="absolute end-3 top-2.5 lg:end-5">
          <FavoriteHeart
            merchantId={merchantId}
            initialFavorite={initialFavorite}
            isAuth={isAuth}
            variant="card"
            className="bg-surface-2 size-9 shrink-0 shadow-none"
          />
        </div>

        {/* NOM (grand, centré) + « Plus d'infos » juste dessous (Bolt). */}
        <div className="px-10 pt-9 text-center lg:pt-10">
          <h1 className="text-foreground text-[24px] leading-tight font-black tracking-tight text-pretty lg:text-[28px]">
            {name}
          </h1>
          {categoryLabel && (
            <p className="text-muted text-body-sm mt-0.5 truncate font-medium">
              {categoryLabel}
            </p>
          )}
          <button
            type="button"
            onClick={() => setShowHours(true)}
            className="text-foreground text-title-sm mt-1.5 inline-flex items-center gap-1 font-extrabold"
          >
            {t("moreInfo")}
            <ChevronDown className="size-4 -rotate-90 rtl:rotate-90" />
          </button>
        </div>

        {/* ───── RANGÉE D'INFOS façon Bolt (capture food.bolt.eu) : 3 COLONNES
                centrées séparées par de fins filets — icône + valeur en GRAS
                sur la 1re ligne, libellé gris dessous. Pas de pilules. ───── */}
        <div className="divide-border mx-auto mt-4 flex max-w-[440px] items-stretch divide-x">
          <div className="flex min-w-0 flex-1 items-center justify-center">
            <MerchantReviewsDialog
              ratingAvg={rating_avg}
              ratingCount={rating_count}
              reviews={reviews}
              variant="stat"
            />
          </div>
          <button
            type="button"
            onClick={() => setShowHours(true)}
            className="flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 transition-opacity active:opacity-70"
          >
            <span className="text-foreground text-title-sm inline-flex items-center gap-1 font-extrabold">
              <ShoppingBasket className="size-4" />
              {t("statFree")}
            </span>
            <span className="text-muted text-label font-medium">
              {t("statPickup")}
            </span>
          </button>
          {prep_time_min > 0 && (
            <div className="flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5">
              <span className="text-foreground text-title-sm inline-flex items-center gap-1 font-extrabold tabular-nums">
                <Timer className="size-4" />
                {prep_time_min}
              </span>
              <span className="text-muted text-label font-medium">
                {t("statMin")}
              </span>
            </div>
          )}
        </div>
      </div>

      {/* « Plus d'infos » — POP-UP (feuille animée), ORDRE Bolt Food Market :
          1. horaires (résumé du jour, tap → semaine) · 2. services ·
          3. carte + adresse + itinéraire · 4. description / contact / infos. */}
      {showHours && (
        <MoreInfoSheet
          openingHours={opening_hours}
          todayKey={todayKey}
          isOpen={isOpen}
          todayLabel={todayLabel}
          name={name}
          addressLine={addressLine}
          address={address}
          latitude={latitude}
          longitude={longitude}
          phonePublic={phone_public}
          descriptionFr={description_fr}
          descriptionAr={description_ar}
          tags={tags}
          minOrderDa={min_order_da}
          prepTimeMin={prep_time_min}
          services={{
            delivery: delivery_enabled,
            express: express_enabled,
            tours: tours_enabled,
            cash: accepts_cash,
            online: accepts_online,
            radiusKm: delivery_radius_km,
          }}
          onClose={() => setShowHours(false)}
        />
      )}
    </div>
  );
}

type MoreInfoServices = {
  delivery: boolean;
  express: boolean;
  tours: boolean;
  cash: boolean;
  online: boolean;
  radiusKm: number | null;
};

/** Feuille « Plus d'infos » façon Bolt Food Market — ORDRE :
 *  1. « Ouvert maintenant · créneaux du jour » (tap → planning de la semaine) ;
 *  2. badges SERVICES (retrait gratuit, express, tournée, paiements) ;
 *  3. CARTE d'emplacement + adresse + bouton Itinéraire (plein écran au tap) ;
 *  4. description, téléphone, infos pratiques, spécialités. */
function MoreInfoSheet({
  openingHours,
  todayKey,
  isOpen,
  todayLabel,
  name,
  addressLine,
  address,
  latitude,
  longitude,
  phonePublic,
  descriptionFr,
  descriptionAr,
  tags = [],
  minOrderDa = 0,
  prepTimeMin = 0,
  services,
  onClose,
}: {
  openingHours: OpeningHours;
  todayKey: (typeof DAY_KEYS)[number];
  isOpen: boolean;
  todayLabel: string;
  name: string;
  addressLine: string;
  address?: string | null;
  latitude?: number | null;
  longitude?: number | null;
  phonePublic?: string | null;
  descriptionFr?: string | null;
  descriptionAr?: string | null;
  tags?: string[];
  minOrderDa?: number;
  prepTimeMin?: number;
  services: MoreInfoServices;
  onClose: () => void;
}) {
  const t = useTranslations("merchant");
  const locale = useLocale();
  // Planning de la semaine REPLIÉ par défaut (Bolt) : la 1re ligne résume le
  // jour, un tap déplie les 7 jours.
  const [showWeek, setShowWeek] = useState(false);
  return (
    <Portal>
      <div
        className="partner-overlay-in fixed inset-0 z-[100] flex items-end justify-center bg-black/50 p-0 backdrop-blur-[2px] sm:items-center sm:p-4"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div
          className="bg-surface partner-sheet-in rounded-t-panel sm:rounded-panel flex max-h-[85vh] w-full max-w-md flex-col pb-[env(safe-area-inset-bottom)]"
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
                {t("moreInfo")}
              </h2>
              <p
                className={cn(
                  "text-body-sm mt-0.5 inline-flex items-center gap-1.5 font-extrabold",
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
            {/* 1) HORAIRES — résumé du jour, tap → planning de la semaine. */}
            <button
              type="button"
              onClick={() => setShowWeek((v) => !v)}
              aria-expanded={showWeek}
              className="border-border rounded-card-lg flex w-full items-center gap-2 border px-3.5 py-3 text-start"
            >
              <span
                className={cn(
                  "size-2 shrink-0 rounded-full",
                  isOpen ? "bg-success-500" : "bg-rose-500"
                )}
              />
              <span className="text-body min-w-0 flex-1">
                <b className={isOpen ? "text-success-700" : "text-rose-600"}>
                  {isOpen ? t("openNowShort") : t("closedNowShort")}
                </b>
                {todayLabel && (
                  <span className="text-foreground font-semibold tabular-nums">
                    {" "}
                    · {todayLabel}
                  </span>
                )}
              </span>
              <ChevronDown
                className={cn(
                  "text-muted size-4 shrink-0 transition-transform",
                  showWeek && "rotate-180"
                )}
              />
            </button>
            {showWeek && (
              <ul className="border-border divide-border rounded-card-lg mt-2 divide-y border">
                {DAY_KEYS.map((d) => {
                  const slots = openingHours[d] ?? [];
                  const isToday = d === todayKey;
                  return (
                    <li
                      key={d}
                      className={cn(
                        "text-body-sm first:rounded-t-card last:rounded-b-card flex items-center justify-between gap-2 px-3.5 py-2.5",
                        isToday && "bg-primary-50"
                      )}
                    >
                      <span className="inline-flex items-center gap-1.5 font-semibold">
                        {dayLongLabel(d, locale)}
                        {isToday && (
                          <span
                            className={cn(
                              "text-nano rounded-full px-1.5 py-px font-extrabold",
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
                          : slots
                              .map((s) => `${s.open}–${s.close}`)
                              .join(" · ")}
                      </span>
                    </li>
                  );
                })}
              </ul>
            )}

            {/* 2) SERVICES — badges (retrait, livraisons, paiements). */}
            <p className="text-muted text-caption mt-4 mb-1.5 font-bold tracking-wide uppercase">
              {t("servicesLabel")}
            </p>
            <div className="flex flex-wrap gap-1.5">
              <ServiceBadge label={t("pickupFree")} strong />
              {services.delivery && services.express && (
                <ServiceBadge
                  label={t("deliveryExpress")}
                  sub={t("feeByDistance")}
                />
              )}
              {services.delivery && services.tours && (
                <ServiceBadge label={t("deliveryTour")} sub={t("feeByZone")} />
              )}
              {services.delivery && services.radiusKm != null && (
                <ServiceBadge
                  label={t("deliveryRadius", { km: services.radiusKm })}
                />
              )}
              {services.online && <ServiceBadge label={t("payOnline")} />}
              {services.cash && <ServiceBadge label={t("payCash")} />}
            </div>

            {/* 3) CARTE — emplacement exact + adresse + Itinéraire (plein
                écran au tap). Repli : simple ligne adresse si pas de GPS. */}
            {latitude != null && longitude != null ? (
              <div className="mt-4">
                <MerchantMapCard
                  lat={latitude}
                  lng={longitude}
                  name={name}
                  address={address || addressLine || null}
                />
              </div>
            ) : (
              addressLine && (
                <p className="text-muted text-label-lg mt-4 flex items-center gap-1.5 font-semibold">
                  <MapPin className="text-primary-600 size-4 shrink-0" />
                  {address || addressLine}
                </p>
              )
            )}

            {/* 4) Description (FR puis AR). */}
            {(descriptionFr || descriptionAr) && (
              <div className="mt-4">
                {descriptionFr && (
                  <p className="text-foreground text-body-sm leading-relaxed">
                    {descriptionFr}
                  </p>
                )}
                {descriptionAr && (
                  <p
                    className="text-foreground text-body-sm mt-1 leading-relaxed"
                    dir="rtl"
                  >
                    {descriptionAr}
                  </p>
                )}
              </div>
            )}

            {/* Téléphone (si public) + infos pratiques. */}
            {(phonePublic || minOrderDa > 0 || prepTimeMin > 0) && (
              <div className="mt-4">
                <p className="text-muted text-caption mb-1.5 font-bold tracking-wide uppercase">
                  {t("practicalInfo")}
                </p>
                <ul className="border-border divide-border rounded-card-lg divide-y border">
                  {phonePublic && (
                    <li>
                      <a
                        href={`tel:${phonePublic}`}
                        className="text-body-sm flex items-center justify-between gap-2 px-3.5 py-2.5"
                      >
                        <span className="text-muted inline-flex items-center gap-2 font-semibold">
                          <Phone className="size-4" />
                          {t("phoneLabel")}
                        </span>
                        <span className="text-primary-700 font-bold tabular-nums">
                          {phonePublic}
                        </span>
                      </a>
                    </li>
                  )}
                  {minOrderDa > 0 && (
                    <li className="text-body-sm flex items-center justify-between gap-2 px-3.5 py-2.5">
                      <span className="text-muted inline-flex items-center gap-2 font-semibold">
                        <ShoppingBasket className="size-4" />
                        {t("minBasketLabel")}
                      </span>
                      <span className="text-foreground font-bold">
                        {formatDA(minOrderDa)}
                      </span>
                    </li>
                  )}
                  {prepTimeMin > 0 && (
                    <li className="text-body-sm flex items-center justify-between gap-2 px-3.5 py-2.5">
                      <span className="text-muted inline-flex items-center gap-2 font-semibold">
                        <Timer className="size-4" />
                        {t("prepLabel")}
                      </span>
                      <span className="text-foreground font-bold">
                        ~{t("prepMinutes", { count: prepTimeMin })}
                      </span>
                    </li>
                  )}
                </ul>
              </div>
            )}

            {/* Spécialités. */}
            {tags.length > 0 && (
              <div className="mt-4 flex flex-wrap gap-1.5">
                {tags.slice(0, 8).map((code) => (
                  <span
                    key={code}
                    className="bg-primary-50 text-primary-700 text-caption rounded-full px-2.5 py-0.5 font-bold"
                  >
                    {getTagLabel(code, locale)}
                  </span>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
}

/** Badge de service (feuille « Plus d'infos ») : libellé + précision grise. */
function ServiceBadge({
  label,
  sub,
  strong = false,
}: {
  label: string;
  sub?: string;
  strong?: boolean;
}) {
  return (
    <span
      className={cn(
        "text-label inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 font-bold",
        strong
          ? "bg-success-100 text-success-700"
          : "bg-surface-2 text-foreground"
      )}
    >
      {label}
      {sub && <span className="text-muted font-medium">· {sub}</span>}
    </span>
  );
}
