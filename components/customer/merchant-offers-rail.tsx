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
  Ticket,
  Timer,
  Truck,
  X,
  type LucideIcon,
} from "lucide-react";
import { cn, formatDA } from "@/lib/utils";
import { Portal } from "@/components/ui/portal";
import type { PublicPromotion } from "@/lib/data/customer-catalog";

// =============================================================================
// MerchantOffersRail — carrousel COMPACT et CLASSÉ des offres d'une boutique.
// =============================================================================
// Une seule bande horizontale (scroll-snap) de petites cartes, ordonnées de la
// plus attractive à la moins (cf. lib/promotions/ranking). Les ventes flash
// affichent un COMPTE À REBOURS live. Toucher une carte ouvre une feuille de
// détail (conditions, code copiable, cadeau, produits concernés). Design
// volontairement compact — n'encombre pas la fiche commerce.
// =============================================================================

export type OfferProduct = {
  name: string;
  image_url: string | null;
  price_da: number;
};

type ProductsById = Record<string, OfferProduct>;

type TypeMeta = {
  Icon: LucideIcon;
  labelKey: string;
  card: string; // fond + bordure de la carte
  pill: string; // pastille icône
  value: string; // couleur de la valeur
};

const TYPE_META: Record<PublicPromotion["type"], TypeMeta> = {
  flash_sale: {
    Icon: Timer,
    labelKey: "typeFlashSale",
    card: "border-danger-200 bg-danger-50",
    pill: "bg-danger-600 text-white",
    value: "text-danger-700",
  },
  anti_gaspillage: {
    Icon: Leaf,
    labelKey: "typeAntiWaste",
    card: "border-success-200 bg-success-50",
    pill: "bg-success-600 text-white",
    value: "text-success-700",
  },
  quantity_offer: {
    Icon: Layers,
    labelKey: "typeQuantityOffer",
    card: "border-accent-200 bg-accent-50",
    pill: "bg-accent-600 text-white",
    value: "text-accent-700",
  },
  free_delivery: {
    Icon: Truck,
    labelKey: "typeFreeDelivery",
    card: "border-primary-200 bg-primary-50",
    pill: "bg-primary-600 text-white",
    value: "text-primary-700",
  },
  free_gift: {
    Icon: Gift,
    labelKey: "typeGift",
    card: "border-accent-200 bg-accent-50",
    pill: "bg-accent-600 text-white",
    value: "text-accent-700",
  },
  product_discount: {
    Icon: BadgePercent,
    labelKey: "typeDiscount",
    card: "border-primary-200 bg-primary-50",
    pill: "bg-primary-600 text-white",
    value: "text-primary-700",
  },
  promo_code: {
    Icon: Ticket,
    labelKey: "typePromoCode",
    card: "border-accent-200 bg-accent-50",
    pill: "bg-accent-600 text-white",
    value: "text-accent-700",
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
  const text = d > 0 ? `${d}j ${h}h` : h > 0 ? `${h}h ${m}m` : `${m}m ${sec}s`;
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

export function MerchantOffersRail({
  offers,
  productsById,
  promoPriceById,
}: {
  offers: PublicPromotion[];
  productsById: ProductsById;
  promoPriceById: Record<string, number>;
}) {
  const t = useTranslations("browse");
  const [openId, setOpenId] = useState<string | null>(null);
  if (offers.length === 0) return null;
  const active = offers.find((o) => o.id === openId) ?? null;

  return (
    <section className="space-y-2">
      <h2 className="text-foreground flex items-center gap-1.5 px-0.5 text-sm font-extrabold">
        <BadgePercent className="text-accent-600 size-4" />
        {t("offersTitle")}
      </h2>
      <div className="-mx-4 flex snap-x [scrollbar-width:none] gap-2.5 overflow-x-auto px-4 pb-1 lg:-mx-6 lg:px-6 [&::-webkit-scrollbar]:hidden">
        {offers.map((o) => (
          <OfferCard key={o.id} promo={o} onOpen={() => setOpenId(o.id)} />
        ))}
      </div>

      {active && (
        <OfferDetailSheet
          promo={active}
          productsById={productsById}
          promoPriceById={promoPriceById}
          onClose={() => setOpenId(null)}
        />
      )}
    </section>
  );
}

function OfferCard({
  promo,
  onOpen,
}: {
  promo: PublicPromotion;
  onOpen: () => void;
}) {
  const t = useTranslations("browse");
  const meta = TYPE_META[promo.type];
  const Icon = meta.Icon;
  const isFlash = promo.type === "flash_sale";
  const countdown = useCountdown(isFlash ? promo.ends_at : null);
  const value = offerValue(promo, t);
  const condition = offerCondition(promo, t);

  // Une vente flash terminée côté client : on n'affiche plus la carte.
  if (isFlash && countdown.ended) return null;

  return (
    <button
      type="button"
      onClick={onOpen}
      className={cn(
        "relative flex w-[152px] shrink-0 snap-start flex-col justify-between overflow-hidden rounded-[16px] border p-3 text-start transition-transform active:scale-[0.98]",
        meta.card
      )}
      style={{ minHeight: 104 }}
    >
      <div className="flex items-center gap-1.5">
        <span
          className={cn(
            "grid size-6 shrink-0 place-items-center rounded-[8px]",
            meta.pill
          )}
        >
          <Icon className="size-3.5" />
        </span>
        <span className={cn("truncate text-[11px] font-bold", meta.value)}>
          {t(meta.labelKey)}
        </span>
      </div>

      <p
        className={cn(
          "mt-1.5 truncate text-xl leading-none font-black",
          meta.value,
          value.mono && "font-mono tracking-tight"
        )}
      >
        {value.text}
      </p>

      <div className="mt-1.5 min-h-[16px]">
        {isFlash && countdown.mounted ? (
          <span className="bg-danger-600 inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-[11px] font-bold text-white">
            <Timer className="size-3" />
            {countdown.text}
          </span>
        ) : condition ? (
          <span className="text-muted block truncate text-[11px] font-medium">
            {condition}
          </span>
        ) : null}
      </div>
    </button>
  );
}

function OfferDetailSheet({
  promo,
  productsById,
  promoPriceById,
  onClose,
}: {
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
        .map((id) => ({ id, p: productsById[id] }))
        .filter((x): x is { id: string; p: OfferProduct } => !!x.p),
    [promo.product_ids, productsById]
  );

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
        className="fixed inset-0 z-[100] flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4"
        onClick={(e) => {
          if (e.target === e.currentTarget) onClose();
        }}
      >
        <div
          className="bg-surface flex max-h-[85vh] w-full max-w-md flex-col rounded-t-[20px] shadow-xl sm:rounded-[20px]"
          role="dialog"
          aria-modal="true"
        >
          <header className="border-border flex items-center justify-between gap-3 border-b px-5 py-4">
            <span className="flex items-center gap-2">
              <span
                className={cn(
                  "grid size-8 place-items-center rounded-[10px]",
                  meta.pill
                )}
              >
                <Icon className="size-4" />
              </span>
              <span className="font-display text-foreground text-base font-bold">
                {t(meta.labelKey)}
              </span>
            </span>
            <button
              type="button"
              onClick={onClose}
              className="text-muted hover:bg-surface-2 rounded-full p-1.5"
              aria-label={t("offerClose")}
            >
              <X className="size-5" />
            </button>
          </header>

          <div className="space-y-4 overflow-y-auto px-5 py-4">
            <div>
              <p
                className={cn(
                  "text-2xl leading-none font-black",
                  meta.value,
                  value.mono && "font-mono"
                )}
              >
                {value.text}
              </p>
              <p className="text-foreground mt-1 text-sm font-semibold">
                {title}
              </p>
              {promo.type === "flash_sale" &&
                countdown.mounted &&
                !countdown.ended && (
                  <span className="bg-danger-600 mt-2 inline-flex items-center gap-1 rounded-full px-2.5 py-1 text-[12px] font-bold text-white">
                    <Timer className="size-3.5" />
                    {t("flashEndsIn", { time: countdown.text })}
                  </span>
                )}
            </div>

            {/* Code copiable */}
            {code && (
              <button
                type="button"
                onClick={copy}
                className="border-accent-300 bg-accent-50 flex w-full items-center gap-3 rounded-[14px] border border-dashed px-3.5 py-3"
              >
                <span className="border-accent-300 rounded-md border bg-[#fff] px-2.5 py-1 font-mono text-base font-black tracking-wider text-[#e6007a]">
                  {code}
                </span>
                <span className="text-accent-600 flex-1 text-start text-[12px] font-medium">
                  {copied ? t("offerCodeCopied") : t("offerTapCode")}
                </span>
                <span
                  className={cn(
                    "grid size-9 shrink-0 place-items-center rounded-full shadow-sm",
                    copied
                      ? "bg-success-600 text-white"
                      : "bg-[#fff] text-[#e6007a]"
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
                <p className="text-foreground mb-1.5 text-[12px] font-bold">
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

            {/* Produits concernés (réductions / offres quantité). */}
            {products.length > 0 && (
              <div>
                <p className="text-foreground mb-1.5 text-[12px] font-bold">
                  {t("concernedProducts")}
                </p>
                <ul className="space-y-2">
                  {products.slice(0, 8).map(({ id, p }) => {
                    const promoPrice = promoPriceById[id];
                    return (
                      <li key={id} className="flex items-center gap-3">
                        <span className="bg-surface-2 size-11 shrink-0 overflow-hidden rounded-[10px]">
                          {p.image_url && (
                            // eslint-disable-next-line @next/next/no-img-element
                            <img
                              src={p.image_url}
                              alt=""
                              loading="lazy"
                              className="size-full object-cover"
                            />
                          )}
                        </span>
                        <span className="text-foreground min-w-0 flex-1 truncate text-sm font-medium">
                          {p.name}
                        </span>
                        <span className="shrink-0 text-sm font-bold tabular-nums">
                          {promoPrice != null && promoPrice < p.price_da ? (
                            <>
                              <span className="text-muted me-1.5 font-normal line-through">
                                {formatDA(p.price_da)}
                              </span>
                              <span className="text-accent-700">
                                {formatDA(promoPrice)}
                              </span>
                            </>
                          ) : (
                            <span className="text-foreground">
                              {formatDA(p.price_da)}
                            </span>
                          )}
                        </span>
                      </li>
                    );
                  })}
                </ul>
                <p className="text-muted mt-2 text-[12px]">
                  {t("seeProductsInMenu")}
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </Portal>
  );
}
