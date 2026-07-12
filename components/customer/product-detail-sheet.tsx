"use client";

import { useEffect, useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import {
  formatQty,
  isFractionalUnit,
  maxQtyFor,
  minQtyFor,
  qtyStep,
  roundQty,
} from "@/lib/units";
import { Minus, Plus, ShoppingBag, X } from "lucide-react";
import { cn, formatDA } from "@/lib/utils";
import {
  useCart,
  setItemQuantity,
  lineKeyFor,
  type SelectedOption,
} from "@/lib/customer/cart-store";
import { trackViewItem } from "@/lib/analytics/ecommerce";
import { useCartAdd } from "@/components/customer/cart-mono-provider";
import type { PublicProduct } from "@/lib/data/customer-catalog";

type Props = {
  merchant: {
    id: string;
    slug: string;
    name: string;
    logo_url?: string | null;
  };
  product: PublicProduct | null;
  promoUnitPriceDa: number | null;
  onClose: () => void;
};

/**
 * Sheet bottom (mobile) / dialog centré (desktop) — détails produit + sélection
 * des OPTIONS/VARIANTES (bilingue FR/AR). Le prix se recalcule en direct (base
 * + Σ deltas), les groupes obligatoires bloquent l'ajout tant qu'ils ne sont
 * pas satisfaits, et chaque combinaison d'options forme une ligne distincte.
 */
export function ProductDetailSheet({
  merchant,
  product,
  promoUnitPriceDa,
  onClose,
}: Props) {
  const t = useTranslations("merchant");
  const locale = useLocale();
  const { requestAdd } = useCartAdd();
  const cart = useCart();
  const [qty, setQty] = useState(1);

  // Vente au poids/volume/longueur (kg, L, m) : le client choisit
  // OBLIGATOIREMENT la quantité, au pas de l'unité (250 g / 25 cl / 50 cm).
  const fractional = isFractionalUnit(product?.unit);
  const step = qtyStep(product?.unit);
  // Bornes imposées par le commerçant : min par ligne, max par commande
  // (revalidées serveur au checkout — ici on guide juste le stepper).
  const minQ = minQtyFor(product?.unit, product?.min_qty);
  const maxQ = maxQtyFor(product?.unit, product?.max_qty, product?.stock_qty);
  // Options choisies : groupId → liste d'optionIds sélectionnés.
  const [selected, setSelected] = useState<Record<string, string[]>>({});

  const groups = useMemo(() => product?.option_groups ?? [], [product]);

  // Ouverture d'un produit : préselectionne la 1re option des groupes
  // obligatoires à choix exclusif, réinitialise la quantité.
  useEffect(() => {
    if (!product) return;
    const init: Record<string, string[]> = {};
    for (const g of product.option_groups ?? []) {
      if (g.min_select >= 1 && g.max_select === 1 && g.options[0]) {
        init[g.id] = [g.options[0].id];
      }
    }
    setSelected(init);
    setQty(
      Math.max(fractional ? 1 : 1, minQtyFor(product.unit, product.min_qty))
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.id]);

  // Options sélectionnées → snapshot ordonné (ordre des groupes puis options).
  const selectedOptions: SelectedOption[] = useMemo(
    () =>
      groups.flatMap((g) =>
        (selected[g.id] ?? [])
          .map((oid) => g.options.find((o) => o.id === oid))
          .filter((o): o is NonNullable<typeof o> => !!o)
          .map((o) => ({
            option_id: o.id,
            group_id: g.id,
            group_name_fr: g.name_fr,
            group_name_ar: g.name_ar,
            option_name_fr: o.name_fr,
            option_name_ar: o.name_ar,
            price_delta_da: o.price_delta_da,
          }))
      ),
    [groups, selected]
  );

  const hasPromo =
    promoUnitPriceDa != null &&
    product != null &&
    promoUnitPriceDa < product.price_da;
  const basePrice = hasPromo ? promoUnitPriceDa! : (product?.price_da ?? 0);
  const deltaSum = selectedOptions.reduce((s, o) => s + o.price_delta_da, 0);
  const unitPrice = basePrice + deltaSum;
  const lineTotal = Math.round(unitPrice * qty);

  const lineKey = product ? lineKeyFor(product.id, selectedOptions) : "";
  const inCart = cart.items.find((i) => i.line_key === lineKey);

  // Groupes obligatoires non satisfaits → ajout bloqué.
  const missing = groups.filter(
    (g) => g.min_select >= 1 && (selected[g.id]?.length ?? 0) < g.min_select
  );
  const canAdd = missing.length === 0;

  // Synchronise la quantité affichée avec la ligne existante (si la combinaison
  // choisie est déjà au panier).
  useEffect(() => {
    if (!product) return;
    const existing = cart.items.find((i) => i.line_key === lineKey);
    setQty(existing?.quantity ?? Math.max(1, minQ));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lineKey]);

  // GA4 — view_item à l'ouverture d'une fiche produit.
  useEffect(() => {
    if (!product) return;
    const eff = hasPromo ? promoUnitPriceDa! : product.price_da;
    trackViewItem(
      {
        id: product.id,
        name: product.name_fr,
        unitPriceDa: eff,
        quantity: 1,
        category: product.category ?? null,
      },
      merchant.name
    );
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.id]);

  // Echap pour fermer.
  useEffect(() => {
    if (!product) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [product, onClose]);

  if (!product) return null;

  function toggle(groupId: string, maxSelect: number, optId: string) {
    setSelected((prev) => {
      const cur = prev[groupId] ?? [];
      if (maxSelect === 1) return { ...prev, [groupId]: [optId] };
      if (cur.includes(optId))
        return { ...prev, [groupId]: cur.filter((x) => x !== optId) };
      if (cur.length >= maxSelect) return prev; // plafond atteint
      return { ...prev, [groupId]: [...cur, optId] };
    });
  }

  function addOrUpdate() {
    if (!canAdd) return;
    if (inCart) {
      // Pas de toast « quantité mise à jour » (règle produit anti-toast) :
      // la barre panier et la ligne produit reflètent déjà la nouvelle
      // quantité — retour visuel immédiat sans encombrer l'écran.
      setItemQuantity(lineKey, qty);
    } else {
      requestAdd(merchant, {
        product_id: product!.id,
        name: product!.name_fr,
        name_ar: product!.name_ar,
        unit: product!.unit,
        min_qty: product!.min_qty,
        max_qty: product!.max_qty,
        unit_price_da: unitPrice,
        image_url: product!.image_url,
        category_title: product!.category,
        options: selectedOptions,
        quantity: qty,
      });
    }
    onClose();
  }

  return (
    <div
      className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal
    >
      <div className="flex max-h-[92vh] w-full max-w-md flex-col overflow-hidden rounded-t-[24px] bg-white pb-[env(safe-area-inset-bottom)] shadow-xl sm:rounded-[24px]">
        {/* Image TRÈS grande sur fond blanc pur, sans filet (capture Bolt) ;
            X = cercle GRIS clair en haut à droite. */}
        <div className="relative aspect-[4/3] w-full shrink-0 overflow-hidden bg-white">
          {product.image_url ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img
              src={product.image_url}
              alt=""
              className="h-full w-full object-contain p-6"
            />
          ) : (
            <div className="flex h-full w-full items-center justify-center">
              <ShoppingBag className="text-subtle size-14" />
            </div>
          )}
          <button
            type="button"
            onClick={onClose}
            className="bg-surface-2 text-foreground hover:bg-surface-3 absolute end-3 top-3 flex size-10 items-center justify-center rounded-full"
            aria-label={t("close")}
          >
            <X className="size-5" />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto px-5 pb-5">
          <h2 className="text-foreground text-[22px] leading-tight font-extrabold tracking-tight">
            {product.name_fr}
          </h2>
          {product.name_ar && (
            <p
              className="text-foreground mt-0.5 text-sm font-semibold"
              dir="rtl"
            >
              {product.name_ar}
            </p>
          )}

          {/* PRIX très grand (Bolt) + barré si promo ; prix à l'unité de vente
              sur une LIGNE GRISE dédiée dessous (comme leur « 0,99 €/l »). */}
          <div className="mt-2 flex items-baseline gap-2.5">
            <span
              className={cn(
                "text-[26px] leading-none font-extrabold tabular-nums",
                hasPromo ? "text-success-700" : "text-foreground"
              )}
            >
              {formatDA(basePrice)}
            </span>
            {hasPromo && (
              <span className="text-subtle text-[15px] tabular-nums line-through">
                {formatDA(product.price_da)}
              </span>
            )}
          </div>
          {product.unit && product.unit !== "piece" && (
            <p className="text-muted mt-1 text-[13px] font-medium tabular-nums">
              {formatDA(basePrice)} /{" "}
              {formatQty(1, product.unit, locale).replace(/^1\s*/, "")}
            </p>
          )}

          {(product.description_fr || product.description_ar) && (
            <div className="mt-3 space-y-2">
              {product.description_fr && (
                <p className="text-muted text-sm leading-relaxed">
                  {product.description_fr}
                </p>
              )}
              {product.description_ar && (
                <p className="text-muted text-sm leading-relaxed" dir="rtl">
                  {product.description_ar}
                </p>
              )}
            </div>
          )}

          {/* Options / variantes */}
          {groups.length > 0 && (
            <div className="mt-5 space-y-4">
              {groups.map((g) => {
                const sel = selected[g.id] ?? [];
                const single = g.max_select === 1;
                return (
                  <div key={g.id}>
                    <div className="flex items-baseline justify-between gap-2">
                      <div className="flex items-baseline gap-2">
                        <span className="text-foreground text-sm font-bold">
                          {g.name_fr}
                        </span>
                        {g.name_ar && (
                          <span className="text-muted text-xs" dir="rtl">
                            {g.name_ar}
                          </span>
                        )}
                      </div>
                      <span
                        className={cn(
                          "shrink-0 text-[11px] font-bold",
                          g.min_select >= 1 ? "text-accent-600" : "text-subtle"
                        )}
                      >
                        {g.min_select >= 1
                          ? t("optionRequired")
                          : g.max_select > 1
                            ? t("optionUpTo", { n: g.max_select })
                            : ""}
                      </span>
                    </div>
                    <div className="mt-2 space-y-1.5">
                      {g.options.map((o) => {
                        const checked = sel.includes(o.id);
                        return (
                          <label
                            key={o.id}
                            className={cn(
                              "flex cursor-pointer items-center gap-3 rounded-[12px] border px-3 py-2.5",
                              checked
                                ? "border-primary-400 bg-primary-50"
                                : "border-border"
                            )}
                          >
                            <input
                              type={single ? "radio" : "checkbox"}
                              name={g.id}
                              checked={checked}
                              onChange={() => toggle(g.id, g.max_select, o.id)}
                              className="accent-primary-600 size-4"
                            />
                            <span className="text-foreground flex-1 text-sm font-medium">
                              {o.name_fr}
                              {o.name_ar && (
                                <span
                                  className="text-muted ms-2 text-xs"
                                  dir="rtl"
                                >
                                  {o.name_ar}
                                </span>
                              )}
                            </span>
                            {o.price_delta_da !== 0 && (
                              <span className="text-muted text-xs font-bold tabular-nums">
                                {o.price_delta_da > 0 ? "+" : ""}
                                {formatDA(o.price_delta_da)}
                              </span>
                            )}
                          </label>
                        );
                      })}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {(product.min_qty != null || product.max_qty != null) && (
            <p className="text-muted mt-3 text-xs font-medium">
              {product.min_qty != null &&
                t("qtyMinHint", { qty: formatQty(minQ, product.unit, locale) })}
              {product.min_qty != null && product.max_qty != null && " · "}
              {product.max_qty != null &&
                t("qtyMaxHint", {
                  qty: formatQty(
                    maxQtyFor(product.unit, product.max_qty),
                    product.unit,
                    locale
                  ),
                })}
            </p>
          )}
          {product.stock_qty != null && product.stock_qty <= 5 && (
            <p className="text-warning-700 mt-3 text-xs font-medium">
              {t("onlyLeftInStock", { count: product.stock_qty })}
            </p>
          )}
        </div>

        {/* Pied sticky façon Bolt (capture) : stepper PILULE blanche bordée
            (− qté +) à gauche, gros bouton ARRONDI à droite avec le libellé
            en 1re ligne et le TOTAL dessous. */}
        <div className="flex items-center gap-3 bg-white p-4 pt-2">
          <div className="border-border-strong inline-flex h-14 shrink-0 items-center rounded-full border bg-white px-2">
            <button
              type="button"
              onClick={() => setQty((q) => Math.max(minQ, roundQty(q - step)))}
              className="text-foreground hover:bg-surface-2 flex size-10 items-center justify-center rounded-full"
              aria-label={t("removeOne")}
            >
              <Minus className="size-5" />
            </button>
            <span
              className={cn(
                "text-foreground text-center text-[17px] font-bold tabular-nums",
                fractional ? "min-w-[5ch]" : "min-w-[2ch]"
              )}
            >
              {fractional ? formatQty(qty, product.unit, locale) : qty}
            </span>
            <button
              type="button"
              onClick={() => setQty((q) => Math.min(maxQ, roundQty(q + step)))}
              className="text-foreground hover:bg-surface-2 flex size-10 items-center justify-center rounded-full"
              aria-label={t("addOne")}
            >
              <Plus className="size-5" />
            </button>
          </div>
          <button
            type="button"
            disabled={!canAdd}
            onClick={addOrUpdate}
            className="bg-primary-600 hover:bg-primary-700 flex h-14 min-w-0 flex-1 flex-col items-center justify-center rounded-full px-4 leading-tight text-white transition-colors disabled:opacity-50"
          >
            {!canAdd ? (
              <span className="truncate text-[14px] font-extrabold">
                {t("chooseRequired", { name: missing[0].name_fr })}
              </span>
            ) : (
              <>
                <span className="truncate text-[15px] font-extrabold">
                  {inCart ? t("update") : t("add")}
                </span>
                <span className="text-[13px] font-semibold tabular-nums opacity-95">
                  {formatDA(lineTotal)}
                </span>
              </>
            )}
          </button>
        </div>
      </div>
    </div>
  );
}
