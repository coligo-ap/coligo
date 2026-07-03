"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  BadgePercent,
  ChevronUp,
  Gift,
  Minus,
  Plus,
  ShoppingCart,
  Ticket,
  Trash2,
  X,
} from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { cn, formatDA } from "@/lib/utils";
import { clearCart, setItemQuantity, useCart } from "@/lib/customer/cart-store";
import { formatQty, isFractionalUnit, qtyStep, roundQty } from "@/lib/units";
import { computeCart, isPromotionActive } from "@/lib/promotions/engine";
import { toEnginePromotions } from "@/lib/promotions/cart-summary";
import { APP_CONFIG } from "@/lib/config/app-config";
import { useConfirm } from "@/components/ui/confirm";
import { getCartPromotions } from "@/app/(customer)/cart/actions";
import type { PublicPromotion } from "@/lib/data/customer-catalog";

export function CartView() {
  const t = useTranslations("cart");
  const locale = useLocale();
  const isAr = locale === "ar";
  const confirm = useConfirm();
  const [detailOpen, setDetailOpen] = useState(false);
  const cart = useCart();
  const empty = cart.items.length === 0;

  // Promotions actives du commerçant du panier (réduction / offre quantité /
  // code). On applique LE MÊME moteur que le checkout → mêmes prix partout.
  const [promotions, setPromotions] = useState<PublicPromotion[]>([]);
  const merchantId = cart.merchant_id;
  useEffect(() => {
    let alive = true;
    if (!merchantId) {
      setPromotions([]);
      return;
    }
    void getCartPromotions(merchantId).then((p) => {
      if (alive) setPromotions(p);
    });
    return () => {
      alive = false;
    };
  }, [merchantId]);

  const enginePromos = useMemo(
    () => toEnginePromotions(promotions),
    [promotions]
  );

  const settled = useMemo(
    () =>
      computeCart(
        cart.items.map((i) => ({
          productId: i.product_id,
          quantity: i.quantity,
          unitPriceDa: i.unit_price_da,
        })),
        enginePromos,
        {
          minPriceDa: APP_CONFIG.promotions.minPriceDa,
          commissionRate: APP_CONFIG.commission.rate,
        }
      ),
    [cart.items, enginePromos]
  );

  // Offre quantité par produit (la plus généreuse) — pour le libellé/indice.
  const offerByProduct = useMemo(() => {
    const map: Record<string, { buy: number; get: number }> = {};
    for (const p of promotions) {
      if (p.type !== "quantity_offer" || !p.buy_qty || !p.get_qty) continue;
      if (
        !isPromotionActive({
          status: p.status,
          startsAt: p.starts_at,
          endsAt: p.ends_at,
        })
      )
        continue;
      for (const pid of p.product_ids) {
        const prev = map[pid];
        const ratio = p.get_qty / (p.buy_qty + p.get_qty);
        const prevRatio = prev ? prev.get / (prev.buy + prev.get) : -1;
        if (ratio > prevRatio) map[pid] = { buy: p.buy_qty, get: p.get_qty };
      }
    }
    return map;
  }, [promotions]);

  // Codes promo actifs (teaser — appliqués au checkout).
  const codePromos = useMemo(
    () =>
      promotions.filter(
        (p) =>
          p.type === "promo_code" &&
          p.code &&
          isPromotionActive({
            status: p.status,
            startsAt: p.starts_at,
            endsAt: p.ends_at,
          })
      ),
    [promotions]
  );

  // Nom de chaque promotion (localisé) pour l'attribuer au produit concerné.
  const promoNameById = useMemo(() => {
    const m = new Map<string, string>();
    for (const p of promotions) m.set(p.id, (isAr && p.title_ar) || p.title_fr);
    return m;
  }, [promotions, isAr]);

  // Détail des avantages PAR PRODUIT : pour chaque ligne en promo, ce que le
  // client gagne selon le type (réduction % avec prix barré, ou unités offertes)
  // + le montant économisé sur ce produit + la/les promo(s) qui s'y appliquent.
  const productBenefits = useMemo(() => {
    return cart.items
      .map((item, index) => {
        // Aligné par INDEX : settled.lines suit l'ordre de cart.items → correct
        // même pour 2 variantes du même produit (même product_id, options ≠).
        const cl = settled.lines[index];
        const appliedUnit = cl?.appliedUnitPriceDa ?? item.unit_price_da;
        const freeUnits = cl?.freeUnits ?? 0;
        const hasDiscount = appliedUnit < item.unit_price_da;
        const discountPct = hasDiscount
          ? Math.round(
              ((item.unit_price_da - appliedUnit) / item.unit_price_da) * 100
            )
          : 0;
        const discountSavings = hasDiscount
          ? (item.unit_price_da - appliedUnit) * item.quantity
          : 0;
        const freeSavings = freeUnits > 0 ? appliedUnit * freeUnits : 0;
        const totalSaved = Math.round(discountSavings + freeSavings);
        const names: string[] = [];
        if (hasDiscount && cl?.productPromotionId) {
          const n = promoNameById.get(cl.productPromotionId);
          if (n) names.push(n);
        }
        if (freeUnits > 0 && cl?.quantityPromotionId) {
          const n = promoNameById.get(cl.quantityPromotionId);
          if (n && !names.includes(n)) names.push(n);
        }
        return {
          item,
          appliedUnit,
          freeUnits,
          hasDiscount,
          discountPct,
          totalSaved,
          names,
        };
      })
      .filter((b) => b.totalSaved > 0 || b.freeUnits > 0);
  }, [cart.items, settled, promoNameById]);

  // Compteur « articles » : une ligne au poids/volume compte pour 1 article
  // (afficher « 2,75 articles » n'aurait pas de sens).
  const units = cart.items.reduce(
    (s, i) => s + (isFractionalUnit(i.unit) ? 1 : i.quantity),
    0
  );
  const subtotal = settled.subtotalDa;
  const savings = Math.max(0, settled.normalTotalDa - settled.subtotalDa);
  const cashbackGain = Math.round(subtotal * 0.03);
  const hasDetail = productBenefits.length > 0 || codePromos.length > 0;

  if (empty) {
    return (
      <div className="mx-auto max-w-xl px-4 py-12 text-center lg:py-20">
        <ShoppingCart className="text-primary-500 mx-auto size-12" />
        <h1 className="text-foreground mt-4 text-2xl font-bold">
          {t("emptyTitle")}
        </h1>
        <p className="text-muted mt-2 text-sm">{t("emptySubtitle")}</p>
        <Link
          href="/"
          className="bg-primary-600 hover:bg-primary-700 mt-6 inline-flex items-center justify-center rounded-[10px] px-4 py-2 text-sm font-medium text-white"
        >
          {t("seeMerchants")}
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-[560px] px-4 pt-3 pb-56">
      {cart.merchant_slug && (
        <Link
          href={`/m/${cart.merchant_slug}`}
          className="bg-surface-2 text-foreground mb-3 inline-flex items-center gap-1.5 rounded-full px-3.5 py-2 text-[13px] font-bold"
        >
          <ArrowLeft className="size-4 rtl:-scale-x-100" />
          {t("backTo")}{" "}
          <span className="text-primary-700">
            {cart.merchant_name ?? t("theShop")}
          </span>
        </Link>
      )}

      <div className="flex items-center justify-between">
        <h1 className="text-foreground text-[26px] font-black tracking-[-0.8px]">
          {t("title")}
        </h1>
        <button
          type="button"
          onClick={async () => {
            const ok = await confirm({
              title: t("clearTitle"),
              message: t("clearConfirm"),
              confirmLabel: t("clear"),
              cancelLabel: t("cancel"),
              danger: true,
            });
            if (ok) clearCart();
          }}
          className="text-danger-600 inline-flex items-center gap-1 text-[13px] font-bold"
        >
          <Trash2 className="size-4" />
          {t("clear")}
        </button>
      </div>
      {cart.merchant_name && (
        <p className="text-muted mt-0.5 text-[13px] font-semibold">
          {t("at")}{" "}
          <span className="text-primary-700">{cart.merchant_name}</span>
        </p>
      )}

      {/* Lignes produit — promos appliquées (prix barré, offert, badges). */}
      <div className="mt-3 space-y-2.5">
        {cart.items.map((item, index) => {
          const cl = settled.lines[index];
          const rawLineTotal = Math.round(item.unit_price_da * item.quantity);
          const lineTotal = cl?.lineTotalDa ?? rawLineTotal;
          const appliedUnit = cl?.appliedUnitPriceDa ?? item.unit_price_da;
          const hasDiscount = appliedUnit < item.unit_price_da;
          const freeUnits = cl?.freeUnits ?? 0;
          const offer = offerByProduct[item.product_id];
          const discountPct = hasDiscount
            ? Math.round(
                ((item.unit_price_da - appliedUnit) / item.unit_price_da) * 100
              )
            : 0;
          // Indice « ajoutez-en N » si une offre existe mais pas encore atteinte.
          const groupSize = offer ? offer.buy + offer.get : 0;
          const needForOffer =
            offer && freeUnits === 0 && item.quantity < groupSize
              ? groupSize - item.quantity
              : 0;

          return (
            <div
              key={item.line_key}
              className="border-border bg-surface flex items-center gap-3 rounded-[16px] border p-3 shadow-sm"
            >
              <div className="bg-surface-2 relative size-[58px] shrink-0 overflow-hidden rounded-[12px]">
                {item.image_url ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img
                    src={item.image_url}
                    alt=""
                    className="h-full w-full object-cover"
                  />
                ) : null}
                {hasDiscount && discountPct > 0 && (
                  <span className="bg-accent-600 absolute start-1 top-1 rounded-full px-1.5 py-0.5 text-[8.5px] font-extrabold text-white shadow-sm">
                    −{discountPct}%
                  </span>
                )}
              </div>

              <div className="min-w-0 flex-1">
                <div className="flex items-baseline justify-between gap-2">
                  <p className="text-foreground line-clamp-1 text-sm font-bold">
                    {item.name}
                  </p>
                  <div className="shrink-0 text-right">
                    <p
                      className={cn(
                        "text-[15px] font-extrabold tabular-nums",
                        lineTotal < rawLineTotal
                          ? "text-accent-600"
                          : "text-foreground"
                      )}
                    >
                      {formatDA(lineTotal)}
                    </p>
                    {lineTotal < rawLineTotal && (
                      <p className="text-subtle text-[11px] tabular-nums line-through">
                        {formatDA(rawLineTotal)}
                      </p>
                    )}
                  </div>
                </div>

                {/* Options/variantes choisies. */}
                {item.options && item.options.length > 0 && (
                  <p className="text-muted mt-0.5 line-clamp-2 text-[11px] font-medium">
                    {item.options.map((o) => o.option_name_fr).join(" · ")}
                  </p>
                )}

                {/* Prix unitaire (barré si réduction). */}
                <p className="text-muted mt-0.5 text-xs font-semibold">
                  {hasDiscount ? (
                    <>
                      <span className="text-accent-600 font-bold">
                        {formatDA(appliedUnit)}
                      </span>{" "}
                      <span className="text-subtle line-through">
                        {formatDA(item.unit_price_da)}
                      </span>
                    </>
                  ) : (
                    t("perUnit", { price: formatDA(item.unit_price_da) })
                  )}
                </p>

                {/* Badges promo (offre quantité). */}
                {(freeUnits > 0 || offer) && (
                  <div className="mt-1 flex flex-wrap items-center gap-1.5">
                    {freeUnits > 0 ? (
                      <span className="bg-accent-600 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-extrabold text-white">
                        <Gift className="size-3" />
                        {t("freeApplied", { count: freeUnits })}
                      </span>
                    ) : (
                      offer && (
                        <span className="bg-accent-50 text-accent-600 dark:bg-accent-950/40 dark:text-accent-300 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-extrabold">
                          <Gift className="size-3" />
                          {t("buyGetLabel", { buy: offer.buy, get: offer.get })}
                        </span>
                      )
                    )}
                    {needForOffer > 0 && (
                      <span className="text-muted text-[10.5px] font-semibold">
                        {t("addForOffer", { count: needForOffer })}
                      </span>
                    )}
                  </div>
                )}
              </div>

              <div className="bg-surface-2 inline-flex shrink-0 items-center rounded-full">
                {(() => {
                  // Pas par unité de la ligne : 1 (pièce), 0.25 (kg/L), 0.5 (m).
                  const step = qtyStep(item.unit);
                  const atMin = item.quantity <= step;
                  return (
                    <>
                      <button
                        type="button"
                        onClick={() => {
                          const next = roundQty(item.quantity - step);
                          setItemQuantity(
                            item.line_key,
                            next < step ? 0 : next
                          );
                        }}
                        aria-label={atMin ? t("remove") : t("removeOne")}
                        className={cn(
                          "flex size-9 items-center justify-center rounded-full",
                          atMin ? "text-danger-600" : "text-primary-700"
                        )}
                      >
                        {atMin ? (
                          <Trash2 className="size-4" />
                        ) : (
                          <Minus className="size-4" />
                        )}
                      </button>
                      <span className="text-foreground min-w-[1.5ch] text-center text-sm font-extrabold whitespace-nowrap tabular-nums">
                        {isFractionalUnit(item.unit)
                          ? formatQty(item.quantity, item.unit, locale)
                          : item.quantity}
                      </span>
                      <button
                        type="button"
                        onClick={() =>
                          setItemQuantity(
                            item.line_key,
                            roundQty(item.quantity + step)
                          )
                        }
                        aria-label={t("addOne")}
                        className="text-primary-700 flex size-9 items-center justify-center rounded-full"
                      >
                        <Plus className="size-4" />
                      </button>
                    </>
                  );
                })()}
              </div>
            </div>
          );
        })}
      </div>

      {/* Barre fixe en bas : un seul card = détail repliable (ouverture vers le
          haut) + cashback + récap sous-total/économies/total + bouton. */}
      <div className="border-border fixed inset-x-0 bottom-16 z-40 border-t bg-white px-4 pt-3 pb-3 shadow-[0_-6px_24px_rgba(40,35,90,0.09)] lg:bottom-0">
        <div className="mx-auto max-w-[560px] space-y-2.5">
          {/* Détail des promotions & économies — s'ouvre VERS LE HAUT. */}
          {hasDetail && detailOpen && (
            <div className="border-border bg-surface-2 max-h-[40vh] space-y-1.5 overflow-y-auto rounded-[12px] border p-2.5">
              {/* En-tête du panneau : titre + fermeture explicite. */}
              <div className="flex items-center justify-between px-1 pb-0.5">
                <span className="text-foreground text-[12px] font-extrabold">
                  {t("promoDetailsTitle")}
                </span>
                <button
                  type="button"
                  onClick={() => setDetailOpen(false)}
                  aria-label={t("close")}
                  className="text-muted hover:text-foreground -m-1 p-1"
                >
                  <X className="size-4" />
                </button>
              </div>

              {/* Un bloc par produit en promo : type d'avantage + gain. */}
              {productBenefits.map((b) => (
                <div
                  key={b.item.line_key}
                  className="bg-surface flex items-start gap-2.5 rounded-[10px] px-2.5 py-2"
                >
                  <div className="bg-surface-2 size-9 shrink-0 overflow-hidden rounded-[8px]">
                    {b.item.image_url ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img
                        src={b.item.image_url}
                        alt=""
                        className="h-full w-full object-cover"
                      />
                    ) : null}
                  </div>

                  <div className="min-w-0 flex-1">
                    <p className="text-foreground line-clamp-1 text-[12.5px] font-bold">
                      {b.item.name}
                    </p>

                    {/* Avantage « réduction » : −X% + prix barré → nouveau prix. */}
                    {b.hasDiscount && (
                      <div className="mt-0.5 flex flex-wrap items-center gap-1.5">
                        {b.discountPct > 0 && (
                          <span className="bg-accent-600 rounded-md px-1.5 py-0.5 text-[9.5px] font-extrabold text-white">
                            −{b.discountPct}%
                          </span>
                        )}
                        <span className="text-[10.5px] font-semibold">
                          <span className="text-accent-600 font-bold">
                            {formatDA(b.appliedUnit)}
                          </span>{" "}
                          <span className="text-subtle line-through">
                            {formatDA(b.item.unit_price_da)}
                          </span>
                        </span>
                      </div>
                    )}

                    {/* Avantage « offre quantité » : N offert(s). */}
                    {b.freeUnits > 0 && (
                      <span className="bg-accent-50 text-accent-600 dark:bg-accent-950/40 dark:text-accent-300 mt-0.5 inline-flex items-center gap-1 rounded-md px-1.5 py-0.5 text-[10px] font-extrabold">
                        <Gift className="size-3" />
                        {t("freeApplied", { count: b.freeUnits })}
                      </span>
                    )}

                    {/* Promotion(s) à l'origine de l'avantage. */}
                    {b.names.length > 0 && (
                      <p className="text-muted mt-0.5 line-clamp-1 text-[10px] font-semibold">
                        {b.names.join(" · ")}
                      </p>
                    )}
                  </div>

                  <span className="text-success-700 dark:text-success-400 shrink-0 pt-0.5 text-[12.5px] font-black tabular-nums">
                    −{formatDA(b.totalSaved)}
                  </span>
                </div>
              ))}

              {/* Codes promo dispo — appliqués à l'étape paiement. */}
              {codePromos.length > 0 && (
                <div className="px-1 pt-0.5">
                  <span className="text-primary-700 dark:text-primary-300 flex items-center gap-1.5 text-[11px] font-bold">
                    <Ticket className="text-accent-600 size-3.5" />
                    {t("promoCodeHint")}
                  </span>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {codePromos.map((p) => {
                      const val =
                        p.discount_kind === "percent"
                          ? `−${p.discount_value} %`
                          : `−${formatDA(p.discount_value ?? 0)}`;
                      return (
                        <span
                          key={p.id}
                          className="border-accent-100 bg-accent-50 text-accent-700 dark:border-accent-500/40 dark:bg-accent-950/40 dark:text-accent-300 inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10.5px] font-bold"
                        >
                          <span className="font-mono font-black tracking-wider">
                            {p.code}
                          </span>
                          <span className="font-black">{val}</span>
                          {p.min_subtotal_da != null && (
                            <span className="text-accent-500/80">
                              ·{" "}
                              {t("promoCodeFrom", {
                                amount: formatDA(p.min_subtotal_da),
                              })}
                            </span>
                          )}
                        </span>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          )}

          {/* Toggle « Voir le détail des promotions et économies ». */}
          {hasDetail && (
            <button
              type="button"
              onClick={() => setDetailOpen((v) => !v)}
              aria-expanded={detailOpen}
              className="text-primary-700 dark:text-primary-300 flex w-full items-center justify-between gap-2 text-[12.5px] font-bold"
            >
              <span className="inline-flex items-center gap-1.5">
                <BadgePercent className="text-accent-600 size-4" />
                {t("promoDetailsToggle")}
              </span>
              <ChevronUp
                className={cn(
                  "size-4 transition-transform",
                  detailOpen && "rotate-180"
                )}
              />
            </button>
          )}

          {cashbackGain > 0 && (
            <div className="bg-success-50 text-success-700 flex items-center gap-2 rounded-[10px] px-3 py-2 text-[12px] font-bold">
              <Gift className="size-4 shrink-0" />
              {t("cashbackGain", { amount: formatDA(cashbackGain) })}
            </div>
          )}
          <div className="flex items-center justify-between">
            <span className="min-w-0">
              <span className="text-muted block text-[13px] font-semibold">
                {t("subtotalUnits", { count: units })}
              </span>
              {savings > 0 && (
                <span className="text-accent-600 dark:text-accent-300 text-[11.5px] font-bold">
                  {t("savings", { amount: formatDA(savings) })}
                </span>
              )}
            </span>
            <span className="flex flex-col items-end leading-none">
              {savings > 0 && (
                <span className="text-subtle mb-0.5 text-[12px] font-semibold tabular-nums line-through">
                  {formatDA(settled.normalTotalDa)}
                </span>
              )}
              <span className="text-foreground text-[21px] font-black tracking-[-0.6px] tabular-nums">
                {formatDA(subtotal)}
              </span>
            </span>
          </div>
          <Link
            href="/checkout"
            className="bg-primary-600 hover:bg-primary-700 inline-flex h-[52px] w-full items-center justify-center gap-2 rounded-[14px] text-base font-extrabold text-white shadow-[0_8px_22px_-6px_rgba(91,91,230,0.55)]"
          >
            {t("checkout")}
            <ArrowRight className="size-5 rtl:-scale-x-100" />
          </Link>
        </div>
      </div>
    </div>
  );
}
