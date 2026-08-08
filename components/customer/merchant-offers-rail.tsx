"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  BadgePercent,
  Check,
  Copy,
  Gift,
  Layers,
  Leaf,
  Plus,
  Ticket,
  Timer,
  Truck,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn, formatDA } from "@/lib/utils";
import { Portal } from "@/components/ui/portal";
import { useCartAdd } from "@/components/customer/cart-mono-provider";
import { isFractionalUnit, minQtyFor } from "@/lib/units";
import {
  BannerCard,
  PromoStyles,
} from "@/components/customer/promo-banner-templates";
import type {
  PublicProduct,
  PublicPromotion,
} from "@/lib/data/customer-catalog";
import type { OfferBannerDesign, PromoBanner } from "@/lib/data/promo-banners";

// =============================================================================
// MerchantOffersRail — carrousel COMPACT et CLASSÉ des offres d'une boutique.
// =============================================================================
// Une seule bande horizontale (scroll-snap) de cartes claires, ordonnées de la
// plus attractive à la moins (cf. lib/promotions/ranking). Design « clean » :
// carte blanche + léger voile teinté par type, pastille dégradée, grande
// valeur, chevron d'affordance (on comprend qu'on peut toucher). Les ventes
// flash affichent un COMPTE À REBOURS live (point pulsant). Toucher une carte
// ouvre une feuille détaillée (poignée, animation, conditions, code copiable,
// produits concernés avec prix barré). Volontairement compact — n'encombre pas
// la fiche commerce.
// =============================================================================

/** Produits COMPLETS indexés par id — nécessaires à l'ajout panier direct. */
type ProductsById = Record<string, PublicProduct>;

export type RailMerchant = {
  id: string;
  slug: string;
  name: string;
  logo_url?: string | null;
};

type TypeMeta = {
  Icon: LucideIcon;
  labelKey: string;
  /** Voile teinté très léger du HAUT de la carte vers le blanc. */
  wash: string;
  /** Pastille icône en dégradé (profondeur, façon iOS). */
  pill: string;
  /** Couleur du libellé de type + de la valeur. */
  value: string;
  /** Bordure au survol / sélection. */
  ring: string;
};

const TYPE_META: Record<PublicPromotion["type"], TypeMeta> = {
  flash_sale: {
    Icon: Timer,
    labelKey: "typeFlashSale",
    wash: "from-danger-50/80",
    pill: "from-danger-500 to-danger-600",
    value: "text-danger-700",
    ring: "hover:border-danger-300",
  },
  anti_gaspillage: {
    Icon: Leaf,
    labelKey: "typeAntiWaste",
    wash: "from-success-50/80",
    pill: "from-success-500 to-success-600",
    value: "text-success-700",
    ring: "hover:border-success-300",
  },
  quantity_offer: {
    Icon: Layers,
    labelKey: "typeQuantityOffer",
    wash: "from-accent-50/80",
    pill: "from-accent-500 to-accent-600",
    value: "text-accent-700",
    ring: "hover:border-accent-300",
  },
  free_delivery: {
    Icon: Truck,
    labelKey: "typeFreeDelivery",
    wash: "from-primary-50/80",
    pill: "from-primary-500 to-primary-600",
    value: "text-primary-700",
    ring: "hover:border-primary-300",
  },
  free_gift: {
    Icon: Gift,
    labelKey: "typeGift",
    wash: "from-accent-50/80",
    pill: "from-accent-500 to-accent-600",
    value: "text-accent-700",
    ring: "hover:border-accent-300",
  },
  product_discount: {
    Icon: BadgePercent,
    labelKey: "typeDiscount",
    wash: "from-primary-50/80",
    pill: "from-primary-500 to-primary-600",
    value: "text-primary-700",
    ring: "hover:border-primary-300",
  },
  promo_code: {
    Icon: Ticket,
    labelKey: "typePromoCode",
    wash: "from-accent-50/80",
    pill: "from-accent-500 to-accent-600",
    value: "text-accent-700",
    ring: "hover:border-accent-300",
  },
};

type T = ReturnType<typeof useTranslations>;

/** Décompte live jusqu'à `endsAt`. `mounted` évite tout écart d'hydratation
 *  (le rendu serveur ne connaît pas l'heure exacte du client). */
function useCountdown(endsAt: string | null) {
  const [mounted, setMounted] = useState(false);
  const [nowMs, setNowMs] = useState(0);
  useEffect(() => {
    setMounted(true);
    setNowMs(Date.now());
    if (!endsAt) return;
    const id = setInterval(() => setNowMs(Date.now()), 1000);
    return () => clearInterval(id);
  }, [endsAt]);
  if (!endsAt || !mounted) return { mounted, ended: false, text: "" };
  const ms = new Date(endsAt).getTime() - nowMs;
  if (ms <= 0) return { mounted, ended: true, text: "" };
  const s = Math.floor(ms / 1000);
  const d = Math.floor(s / 86400);
  const h = Math.floor((s % 86400) / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  // Minuteur « urgence » HH:MM:SS qui tique à la seconde (une vente flash dure
  // 24 h max). Repli « Xj Yh » pour d'éventuelles promos datées plus longues.
  const pad = (n: number) => String(n).padStart(2, "0");
  const text = d > 0 ? `${d}j ${h}h` : `${pad(h)}:${pad(m)}:${pad(sec)}`;
  return { mounted, ended: false, text };
}

/** Grande valeur affichée sur la carte (et la feuille). */
function offerValue(
  p: PublicPromotion,
  t: T
): { text: string; mono?: boolean } {
  const val =
    p.discount_value != null ? Math.round(Number(p.discount_value)) : 0;
  const money = () =>
    p.discount_kind === "percent" ? `−${val}%` : `−${formatDA(val)}`;
  switch (p.type) {
    case "flash_sale":
    case "anti_gaspillage":
    case "product_discount":
      return { text: val ? money() : t("typeDiscount") };
    case "quantity_offer":
      return {
        text: p.get_qty
          ? `${p.get_qty} ${p.get_qty > 1 ? "offerts" : "offert"}`
          : t("typeQuantityOffer"),
      };
    case "promo_code":
      return {
        text: (p.code ?? t("typePromoCode")).toUpperCase(),
        mono: !!p.code,
      };
    case "free_delivery":
      return { text: t("offerValueFree") };
    case "free_gift":
      return { text: p.gift_label || t("offerGift") };
  }
}

/** Petite ligne de condition (montant min, quantité, code, tournée). */
function offerCondition(p: PublicPromotion, t: T): string | null {
  const parts: string[] = [];
  if (p.type === "quantity_offer" && p.buy_qty) {
    parts.push(`pour ${p.buy_qty} ${p.buy_qty > 1 ? "achetés" : "acheté"}`);
  }
  if (p.type === "free_delivery") parts.push(t("offerTourOnly"));
  if (p.type === "promo_code" && p.discount_value != null) {
    const val = Math.round(Number(p.discount_value));
    if (val)
      parts.push(
        p.discount_kind === "percent" ? `−${val}%` : `−${formatDA(val)}`
      );
  }
  if (p.min_subtotal_da != null) {
    parts.push(t("offerMinBasket", { amount: formatDA(p.min_subtotal_da) }));
  }
  return parts.length ? parts.join(" · ") : null;
}

function fmtDate(iso: string, locale: string): string {
  return new Date(iso).toLocaleDateString(locale === "ar" ? "ar-DZ" : "fr-DZ", {
    day: "numeric",
    month: "long",
    year: "numeric",
    timeZone: "Africa/Algiers",
  });
}

/**
 * Offre → forme `PromoBanner`, pour la rendre avec la MÊME carte que l'accueil
 * client (`BannerCard`). `design` = habillage choisi par le super-admin sur la
 * bannière reliée à cette offre ; absent ⇒ modèle AUTOMATIQUE déduit du type.
 */
function toBannerShape(
  promo: PublicPromotion,
  merchant: RailMerchant,
  design: OfferBannerDesign | undefined,
  productsById: ProductsById,
  fallback: { title: string; subtitle: string | null; cta: string }
): PromoBanner {
  const products = promo.product_ids
    .map((id) => productsById[id])
    .filter((p): p is PublicProduct => !!p)
    .slice(0, 8)
    .map((p) => ({
      id: p.id,
      name_fr: p.name_fr,
      name_ar: p.name_ar,
      image_url: p.image_url,
      price_da: p.price_da,
    }));

  return {
    id: promo.id,
    title: design?.title || fallback.title,
    subtitle: design?.subtitle ?? fallback.subtitle,
    cta_label: design?.cta_label || fallback.cta,
    image_url: design?.image_url ?? null,
    image_fit: design?.image_fit ?? "overlay",
    overlay_opacity: design?.overlay_opacity ?? 30,
    link: null,
    accent: "violet",
    template: design?.template ?? null,
    palette: design?.palette ?? null,
    illustration: design?.illustration ?? null,
    show_products: design ? design.show_products : products.length > 0,
    position: 0,
    merchant_slug: merchant.slug,
    offer: {
      promotion_id: promo.id,
      type: promo.type,
      discount_kind: promo.discount_kind,
      discount_value:
        promo.discount_value != null ? Number(promo.discount_value) : null,
      code: promo.code,
      buy_qty: promo.buy_qty,
      get_qty: promo.get_qty,
      gift_label: promo.gift_label,
      min_subtotal_da: promo.min_subtotal_da,
      title_fr: promo.title_fr,
      title_ar: promo.title_ar,
      ends_at: promo.ends_at,
      merchant_id: merchant.id,
      merchant_name: merchant.name,
      merchant_slug: merchant.slug,
      products,
    },
  };
}

export function MerchantOffersRail({
  merchant,
  offers,
  productsById,
  promoPriceById,
  designs,
}: {
  merchant: RailMerchant;
  offers: PublicPromotion[];
  productsById: ProductsById;
  promoPriceById: Record<string, number>;
  /** Habillages de bannière par promotion (mig 0391/0392), optionnels. */
  designs?: Record<string, OfferBannerDesign>;
}) {
  const t = useTranslations("browse");
  const [openId, setOpenId] = useState<string | null>(null);
  if (offers.length === 0) return null;
  const active = offers.find((o) => o.id === openId) ?? null;
  const single = offers.length === 1;

  return (
    <section className="space-y-2">
      <PromoStyles />
      <div className="flex items-baseline justify-between px-0.5">
        <h2 className="text-foreground flex items-center gap-1.5 text-sm font-extrabold">
          <BadgePercent className="text-accent-600 size-4" />
          {t("offersTitle")}
        </h2>
        {offers.length > 1 && (
          <span className="text-muted text-caption font-semibold tabular-nums">
            {offers.length}
          </span>
        )}
      </div>
      <div className="-mx-4 flex snap-x [scrollbar-width:none] gap-2.5 overflow-x-auto px-4 pb-1.5 lg:-mx-6 lg:px-6 [&::-webkit-scrollbar]:hidden">
        {offers.map((o) => (
          <OfferCard
            key={o.id}
            promo={o}
            merchant={merchant}
            design={designs?.[o.id]}
            productsById={productsById}
            single={single}
            onOpen={() => setOpenId(o.id)}
          />
        ))}
      </div>

      {active && (
        <OfferDetailSheet
          merchant={merchant}
          promo={active}
          productsById={productsById}
          promoPriceById={promoPriceById}
          onClose={() => setOpenId(null)}
        />
      )}
    </section>
  );
}

/**
 * Carte d'offre = LA bannière promo (même modèle que l'accueil client), pour
 * que l'habillage choisi côté super-admin s'applique aussi sur la fiche
 * commerçant. Le visuel est purement décoratif (aucun élément interactif
 * dedans) → l'envelopper d'un `<button>` reste sûr côté hydratation.
 */
function OfferCard({
  promo,
  merchant,
  design,
  productsById,
  single,
  onOpen,
}: {
  promo: PublicPromotion;
  merchant: RailMerchant;
  design: OfferBannerDesign | undefined;
  productsById: ProductsById;
  single: boolean;
  onOpen: () => void;
}) {
  const t = useTranslations("browse");
  const locale = useLocale();
  const isFlash = promo.type === "flash_sale";
  const countdown = useCountdown(isFlash ? promo.ends_at : null);
  const value = offerValue(promo, t);
  const condition = offerCondition(promo, t);

  // Une vente flash terminée côté client : on n'affiche plus la carte.
  if (isFlash && countdown.ended) return null;

  const title =
    locale === "ar" && promo.title_ar ? promo.title_ar : promo.title_fr;
  const banner = toBannerShape(promo, merchant, design, productsById, {
    title: title || value.text,
    subtitle: condition ?? t("offerNoCondition"),
    cta: t("offerSeeDetails"),
  });

  return (
    <button
      type="button"
      onClick={onOpen}
      aria-label={title}
      className={cn(
        "group shrink-0 snap-start text-start transition-transform duration-150 active:scale-[0.98]",
        single ? "w-full" : "w-[92%] max-w-[460px]"
      )}
    >
      <BannerCard banner={banner} />
    </button>
  );
}

function OfferDetailSheet({
  merchant,
  promo,
  productsById,
  promoPriceById,
  onClose,
}: {
  merchant: RailMerchant;
  promo: PublicPromotion;
  productsById: ProductsById;
  promoPriceById: Record<string, number>;
  onClose: () => void;
}) {
  const t = useTranslations("browse");
  const locale = useLocale();
  const meta = TYPE_META[promo.type];
  const Icon = meta.Icon;
  const [copied, setCopied] = useState(false);
  const countdown = useCountdown(
    promo.type === "flash_sale" ? promo.ends_at : null
  );
  const value = offerValue(promo, t);
  const code = (promo.code ?? "").toUpperCase();
  const title =
    locale === "ar" && promo.title_ar ? promo.title_ar : promo.title_fr;

  const conditions: string[] = [];
  if (promo.type === "free_delivery") conditions.push(t("offerTourOnly"));
  if (promo.min_subtotal_da != null) {
    conditions.push(
      t("offerMinBasket", { amount: formatDA(promo.min_subtotal_da) })
    );
  }
  if (promo.ends_at && promo.type !== "flash_sale") {
    conditions.push(
      t("offerExpiresOn", { date: fmtDate(promo.ends_at, locale) })
    );
  }
  if (conditions.length === 0 && !code) conditions.push(t("offerNoCondition"));

  const products = useMemo(
    () =>
      promo.product_ids
        .map((id) => productsById[id])
        .filter((p): p is PublicProduct => !!p),
    [promo.product_ids, productsById]
  );

  // Feuille ouverte = la page DERRIÈRE ne défile plus (sinon, sur mobile, le
  // geste de scroll dans la feuille entraîne la fiche commerçant).
  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, []);

  async function copy() {
    try {
      await navigator.clipboard.writeText(code);
    } catch {
      /* best-effort */
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  }

  return (
    <Portal>
      <div
        className="partner-overlay-in fixed inset-0 z-[100] flex items-end justify-center bg-black/50 p-0 backdrop-blur-[2px] sm:items-center sm:p-4"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        {/* `overflow-hidden` sur la feuille + `min-h-0` sur la zone défilante :
            sans ça, l'enfant flex garde sa hauteur de contenu, ne défile pas,
            et le geste part dans la page. */}
        <div
          className="bg-surface partner-sheet-in rounded-t-panel sm:rounded-panel flex max-h-[85vh] w-full max-w-md flex-col overflow-hidden pb-[env(safe-area-inset-bottom)] shadow-xl"
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
            <div className="flex min-w-0 items-start gap-3">
              <span
                className={cn(
                  "rounded-card grid size-11 shrink-0 place-items-center bg-gradient-to-br text-white shadow-sm",
                  meta.pill
                )}
              >
                <Icon className="size-5" />
              </span>
              <div className="min-w-0">
                <p className={cn("text-label font-extrabold", meta.value)}>
                  {t(meta.labelKey)}
                </p>
                <p
                  className={cn(
                    "text-display truncate leading-tight font-black",
                    meta.value,
                    value.mono && "text-heading font-mono"
                  )}
                >
                  {value.text}
                </p>
              </div>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="text-muted hover:bg-surface-2 mt-0.5 shrink-0 rounded-full p-1.5"
              aria-label={t("offerClose")}
            >
              <X className="size-5" />
            </button>
          </header>

          <div className="min-h-0 flex-1 space-y-4 overflow-y-auto overscroll-contain px-5 pb-5">
            <div>
              <p className="text-foreground text-sm font-semibold">{title}</p>
              {promo.type === "flash_sale" &&
                countdown.mounted &&
                !countdown.ended && (
                  <span className="bg-danger-600 text-label mt-2 inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-bold text-white tabular-nums">
                    <span
                      className="size-1.5 animate-pulse rounded-full bg-white"
                      aria-hidden
                    />
                    {t("flashEndsIn", { time: countdown.text })}
                  </span>
                )}
            </div>

            {/* Code copiable */}
            {code && (
              <button
                type="button"
                onClick={copy}
                className="border-accent-300 bg-accent-50 rounded-card-lg flex w-full items-center gap-3 border border-dashed px-3.5 py-3 transition-transform active:scale-[0.99]"
              >
                <span className="border-accent-300 rounded-md border bg-[#fff] px-2.5 py-1 font-mono text-base font-black tracking-wider text-[var(--color-accent-600)]">
                  {code}
                </span>
                <span className="text-accent-600 text-label flex-1 text-start font-medium">
                  {copied ? t("offerCodeCopied") : t("offerTapCode")}
                </span>
                <span
                  className={cn(
                    "grid size-9 shrink-0 place-items-center rounded-full shadow-sm transition-colors",
                    copied
                      ? "bg-success-600 text-white"
                      : "bg-[#fff] text-[var(--color-accent-600)]"
                  )}
                >
                  {copied ? (
                    <Check className="size-4" />
                  ) : (
                    <Copy className="size-4" />
                  )}
                </span>
              </button>
            )}

            {/* Conditions */}
            {conditions.length > 0 && (
              <div>
                <p className="text-foreground text-label mb-1.5 font-bold">
                  {t("offerConditions")}
                </p>
                <ul className="space-y-1.5">
                  {conditions.map((c, i) => (
                    <li
                      key={i}
                      className="text-muted flex items-start gap-2 text-sm"
                    >
                      <Check className="text-accent-500 mt-0.5 size-4 shrink-0" />
                      <span>{c}</span>
                    </li>
                  ))}
                </ul>
              </div>
            )}

            {/* Produits concernés — AJOUT PANIER DIRECT depuis la feuille
                (vente flash, réductions, offres quantité). */}
            {products.length > 0 && (
              <div>
                <p className="text-foreground text-label mb-1.5 font-bold">
                  {t("concernedProducts")}
                </p>
                <ul className="space-y-2">
                  {products.slice(0, 8).map((p) => (
                    <SheetProductRow
                      key={p.id}
                      merchant={merchant}
                      product={p}
                      promoPrice={promoPriceById[p.id] ?? null}
                      onNeedsDetail={onClose}
                    />
                  ))}
                </ul>
              </div>
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
}

/**
 * Ligne produit de la feuille d'offre, avec AJOUT PANIER direct.
 * Même garde anti « ajout aveugle » que ProductRow : un produit à options ou
 * vendu au poids/volume NE s'ajoute PAS en un tap — on ferme la feuille pour
 * que le client le configure depuis le menu (fiche produit).
 */
function SheetProductRow({
  merchant,
  product,
  promoPrice,
  onNeedsDetail,
}: {
  merchant: RailMerchant;
  product: PublicProduct;
  promoPrice: number | null;
  onNeedsDetail: () => void;
}) {
  const t = useTranslations("merchant");
  const { requestAdd } = useCartAdd();
  const [added, setAdded] = useState(false);

  const hasOptions = (product.option_groups?.length ?? 0) > 0;
  const needsDetail = hasOptions || isFractionalUnit(product.unit);
  const isOut =
    product.is_available === false ||
    (product.stock_qty != null && product.stock_qty <= 0);
  const hasPromo = promoPrice != null && promoPrice < product.price_da;

  function add() {
    if (isOut) return;
    if (needsDetail) {
      // Configuration requise (options / quantité au poids) → retour au menu.
      onNeedsDetail();
      return;
    }
    const ok = requestAdd(merchant, {
      product_id: product.id,
      name: product.name_fr,
      name_ar: product.name_ar,
      unit: product.unit,
      min_qty: product.min_qty,
      max_qty: product.max_qty,
      unit_price_da: product.price_da,
      image_url: product.image_url,
      category_title: product.category,
      quantity: minQtyFor(product.unit, product.min_qty),
    });
    if (ok) {
      setAdded(true);
      setTimeout(() => setAdded(false), 1200);
    }
  }

  return (
    <li className="flex items-center gap-3">
      <span className="border-border rounded-control size-11 shrink-0 overflow-hidden border bg-white">
        {product.image_url && (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={product.image_url}
            alt=""
            loading="lazy"
            className="size-full object-contain p-0.5"
          />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-foreground block truncate text-sm font-medium">
          {product.name_fr}
        </span>
        <span className="text-sm font-bold tabular-nums">
          {hasPromo ? (
            <>
              <span className="text-muted me-1.5 font-normal line-through">
                {formatDA(product.price_da)}
              </span>
              <span className="text-accent-700">{formatDA(promoPrice!)}</span>
            </>
          ) : (
            <span className="text-foreground">
              {formatDA(product.price_da)}
            </span>
          )}
        </span>
      </span>
      <button
        type="button"
        onClick={add}
        disabled={isOut}
        aria-label={t("addToCart")}
        className={cn(
          "flex size-9 shrink-0 items-center justify-center rounded-full border shadow-sm transition-transform active:scale-90",
          isOut
            ? "border-border bg-surface-3 text-subtle cursor-not-allowed"
            : added
              ? "border-success-600 bg-success-600 scale-110 text-white"
              : "border-border text-accent-600 hover:border-accent-300 bg-white"
        )}
      >
        {added ? <Check className="size-4" /> : <Plus className="size-4" />}
      </button>
    </li>
  );
}
