"use client";

import Link from "next/link";
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
import {
  clearCart,
  removeItem,
  setItemQuantity,
  useCart,
} from "@/lib/customer/cart-store";

export function CartView() {
  const t = useTranslations("cart");
  const cart = useCart();
  const empty = cart.items.length === 0;

  const subtotal = cart.items.reduce(
    (s, i) => s + i.unit_price_da * i.quantity,
    0
  );
  const units = cart.items.reduce((s, i) => s + i.quantity, 0);
  // Cashback gagné (gain futur, payé en ligne) — 3% (estimation MVP).
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
    <div className="mx-auto max-w-[560px] px-4 pt-3 pb-40">
      {/* Retour à la boutique */}
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
          onClick={() => {
            if (confirm(t("clearConfirm"))) clearCart();
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

      {/* Lignes produit — cards compactes */}
      <div className="mt-3 space-y-2.5">
        {cart.items.map((item) => (
          <div
            key={item.product_id}
            className="border-border bg-surface flex items-center gap-3 rounded-[16px] border p-3 shadow-sm"
          >
            <div className="bg-surface-2 size-[58px] shrink-0 overflow-hidden rounded-[12px]">
              {item.image_url ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={item.image_url}
                  alt=""
                  className="h-full w-full object-cover"
                />
              ) : null}
            </div>
            <div className="min-w-0 flex-1">
              <p className="text-foreground line-clamp-1 text-sm font-bold">
                {item.name}
              </p>
              <p className="text-muted text-xs font-semibold">
                {t("perUnit", { price: formatDA(item.unit_price_da) })}
              </p>
              <p className="text-foreground mt-0.5 text-[15px] font-extrabold tabular-nums">
                {formatDA(item.unit_price_da * item.quantity)}
              </p>
            </div>
            <div className="bg-surface-2 inline-flex shrink-0 items-center rounded-full">
              <button
                type="button"
                onClick={() =>
                  setItemQuantity(item.product_id, item.quantity - 1)
                }
                aria-label={item.quantity === 1 ? t("remove") : t("removeOne")}
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
        ))}
      </div>

      {/* Barre fixe en bas : cashback gain + sous-total + bouton */}
      <div className="border-border fixed inset-x-0 bottom-16 z-40 border-t bg-white px-4 pt-3 pb-3 shadow-[0_-6px_24px_rgba(40,35,90,0.09)] lg:bottom-0">
        <div className="mx-auto max-w-[560px]">
          {cashbackGain > 0 && (
            <div className="bg-success-50 text-success-700 mb-2.5 flex items-center gap-2 rounded-[10px] px-3 py-2 text-[12px] font-bold">
              <Gift className="size-4 shrink-0" />
              {t("cashbackGain", { amount: formatDA(cashbackGain) })}
            </div>
          )}
          <div className="mb-2.5 flex items-center justify-between">
            <span className="text-muted text-[13px] font-semibold">
              {t("subtotalUnits", { count: units })}
            </span>
            <span className="text-foreground text-[21px] font-black tracking-[-0.6px] tabular-nums">
              {formatDA(subtotal)}
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
