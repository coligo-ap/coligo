"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import {
  ArrowLeft,
  ArrowRight,
  Gift,
  Minus,
  Plus,
  ShoppingCart,
  Trash2,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { cn, formatDA } from "@/lib/utils";
import { clearCart, setItemQuantity, useCart } from "@/lib/customer/cart-store";
import { computeCart, isPromotionActive } from "@/lib/promotions/engine";
import {
  summarizeCartPromotions,
  toEnginePromotions,
} from "@/lib/promotions/cart-summary";
import { APP_CONFIG } from "@/lib/config/app-config";
import { useConfirm } from "@/components/ui/confirm";
import { getCartPromotions } from "@/app/(customer)/cart/actions";
import type { PublicPromotion } from "@/lib/data/customer-catalog";
import { CartSavingsCard } from "./cart-savings-card";

export function CartView() {
  const t = useTranslations("cart");
  const confirm = useConfirm();
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

  const lineById = useMemo(
    () => new Map(settled.lines.map((l) => [l.productId, l])),
    [settled]
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

  // Synthèse premium des promos appliquées (détail + économie par promo).
  const promoSummary = useMemo(
    () => summarizeCartPromotions(promotions, settled),
    [promotions, settled]
  );

  const subtotal = settled.subtotalDa;
  const savings = Math.max(0, settled.normalTotalDa - settled.subtotalDa);
  const cashbackGain = Math.round(subtotal * 0.03);

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
    <div className="mx-auto max-w-[560px] px-4 pt-3 pb-44">
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
        {cart.items.map((item) => {
          const cl = lineById.get(item.product_id);
          const rawLineTotal = item.unit_price_da * item.quantity;
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
              key={item.product_id}
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
                  <span className="bg-coral-500 absolute start-1 top-1 rounded-full px-1.5 py-0.5 text-[8.5px] font-extrabold text-white shadow-sm">
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
                          ? "text-rose-600"
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

                {/* Prix unitaire (barré si réduction). */}
                <p className="text-muted mt-0.5 text-xs font-semibold">
                  {hasDiscount ? (
                    <>
                      <span className="font-bold text-rose-600">
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
                      <span className="inline-flex items-center gap-1 rounded-md bg-rose-600 px-1.5 py-0.5 text-[10px] font-extrabold text-white">
                        <Gift className="size-3" />
                        {t("freeApplied", { count: freeUnits })}
                      </span>
                    ) : (
                      offer && (
                        <span className="inline-flex items-center gap-1 rounded-md bg-rose-50 px-1.5 py-0.5 text-[10px] font-extrabold text-rose-600 dark:bg-rose-950/40 dark:text-rose-300">
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
                <button
                  type="button"
                  onClick={() =>
                    setItemQuantity(item.product_id, item.quantity - 1)
                  }
                  aria-label={
                    item.quantity === 1 ? t("remove") : t("removeOne")
                  }
                  className={cn(
                    "flex size-9 items-center justify-center rounded-full",
                    item.quantity === 1 ? "text-danger-600" : "text-primary-700"
                  )}
                >
                  {item.quantity === 1 ? (
                    <Trash2 className="size-4" />
                  ) : (
                    <Minus className="size-4" />
                  )}
                </button>
                <span className="text-foreground min-w-[1.5ch] text-center text-sm font-extrabold tabular-nums">
                  {item.quantity}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setItemQuantity(item.product_id, item.quantity + 1)
                  }
                  aria-label={t("addOne")}
                  className="text-primary-700 flex size-9 items-center justify-center rounded-full"
                >
                  <Plus className="size-4" />
                </button>
              </div>
            </div>
          );
        })}
      </div>

      {/* Récapitulatif central : sous-total, économies, total à payer (toujours
          visibles) + détail des promos repliable (fermé par défaut). */}
      <CartSavingsCard
        summary={promoSummary}
        codePromos={codePromos}
        normalTotalDa={settled.normalTotalDa}
        subtotalDa={subtotal}
      />

      {/* Barre fixe en bas : CTA persistant avec le total intégré (style Uber). */}
      <div className="border-border fixed inset-x-0 bottom-16 z-40 border-t bg-white px-4 pt-3 pb-3 shadow-[0_-6px_24px_rgba(40,35,90,0.09)] lg:bottom-0">
        <div className="mx-auto max-w-[560px] space-y-2">
          {cashbackGain > 0 && (
            <div className="bg-success-50 text-success-700 flex items-center gap-2 rounded-[10px] px-3 py-2 text-[12px] font-bold">
              <Gift className="size-4 shrink-0" />
              {t("cashbackGain", { amount: formatDA(cashbackGain) })}
            </div>
          )}
          {savings > 0 && (
            <p className="text-center text-[12px] font-bold text-rose-600 dark:text-rose-300">
              {t("savings", { amount: formatDA(savings) })}
            </p>
          )}
          <Link
            href="/checkout"
            className="bg-primary-600 hover:bg-primary-700 flex h-[54px] w-full items-center justify-between gap-2 rounded-[14px] px-5 text-white shadow-[0_8px_22px_-6px_rgba(91,91,230,0.55)]"
          >
            <span className="inline-flex items-center gap-2 text-base font-extrabold">
              {t("checkout")}
              <ArrowRight className="size-5 rtl:-scale-x-100" />
            </span>
            <span className="flex items-baseline gap-2 leading-none">
              {savings > 0 && (
                <span className="text-[12px] font-semibold text-white/60 tabular-nums line-through">
                  {formatDA(settled.normalTotalDa)}
                </span>
              )}
              <span className="text-[18px] font-black tabular-nums">
                {formatDA(subtotal)}
              </span>
            </span>
          </Link>
        </div>
      </div>
    </div>
  );
}
