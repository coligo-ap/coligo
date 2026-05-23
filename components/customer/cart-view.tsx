"use client";

import Link from "next/link";
import {
  ArrowLeft,
  ArrowRight,
  Minus,
  Plus,
  ShoppingBag,
  Trash2,
} from "lucide-react";
import { cn, formatDA } from "@/lib/utils";
import {
  clearCart,
  removeItem,
  setItemQuantity,
  useCart,
} from "@/lib/customer/cart-store";

export function CartView() {
  const cart = useCart();
  const empty = cart.items.length === 0;

  const subtotal = cart.items.reduce(
    (s, i) => s + i.unit_price_da * i.quantity,
    0
  );

  if (empty) {
    return (
      <div className="mx-auto max-w-xl px-4 py-12 text-center lg:py-20">
        <ShoppingBag className="text-primary-500 mx-auto size-12" />
        <h1 className="text-foreground mt-4 text-2xl font-bold">
          Ton panier est vide
        </h1>
        <p className="text-muted mt-2 text-sm">
          Découvre les commerces près de chez toi et remplis ton panier.
        </p>
        <Link
          href="/"
          className="bg-primary-600 hover:bg-primary-700 mt-6 inline-flex items-center justify-center rounded-[10px] px-4 py-2 text-sm font-medium text-white"
        >
          Voir les commerces
        </Link>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-3xl px-4 py-4 pb-24 lg:px-6 lg:py-8 lg:pb-24">
      {/* Bouton retour vers le commerçant — visible et explicite, pour que le
          client puisse repartir voir / ajouter / modifier ses produits sans
          quitter la flow. */}
      {cart.merchant_slug && (
        <Link
          href={`/m/${cart.merchant_slug}`}
          className="border-border bg-surface hover:border-primary-300 mb-4 inline-flex items-center gap-2 rounded-[12px] border px-3 py-2 text-sm font-medium transition-colors"
        >
          <ArrowLeft className="text-primary-600 size-4" />
          <span className="text-foreground">
            Retour à{" "}
            <span className="text-primary-700 font-semibold">
              {cart.merchant_name ?? "la boutique"}
            </span>
          </span>
          <span className="text-muted hidden text-xs sm:inline">
            · ajouter d&apos;autres produits
          </span>
        </Link>
      )}

      <header className="mb-4 flex items-baseline justify-between">
        <div>
          <h1 className="text-foreground text-2xl font-bold lg:text-3xl">
            Mon panier
          </h1>
          {cart.merchant_name && cart.merchant_slug && (
            <p className="text-muted mt-1 text-sm">
              chez{" "}
              <Link
                href={`/m/${cart.merchant_slug}`}
                className="text-primary-700 font-medium hover:underline"
              >
                {cart.merchant_name}
              </Link>
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => {
            if (confirm("Vider tout le panier ?")) clearCart();
          }}
          className="text-danger-600 hover:bg-danger-50 inline-flex items-center gap-1 rounded-[10px] px-2 py-1 text-xs font-medium"
        >
          <Trash2 className="size-3.5" />
          Vider
        </button>
      </header>

      <ul className="border-border bg-surface divide-border divide-y rounded-[16px] border">
        {cart.items.map((item) => (
          <li key={item.product_id} className="flex items-center gap-3 p-4">
            <div className="bg-surface-2 size-16 shrink-0 overflow-hidden rounded-[10px]">
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
              <p className="text-foreground line-clamp-2 text-sm font-semibold">
                {item.name}
              </p>
              <p className="text-muted text-xs">
                {formatDA(item.unit_price_da)} × {item.quantity}
              </p>
            </div>
            <div className="flex flex-col items-end gap-1.5">
              <span className="text-foreground text-sm font-bold tabular-nums">
                {formatDA(item.unit_price_da * item.quantity)}
              </span>
              <div className="bg-primary-50 inline-flex items-center gap-2 rounded-full p-1">
                <button
                  type="button"
                  onClick={() =>
                    setItemQuantity(item.product_id, item.quantity - 1)
                  }
                  className="text-primary-700 hover:bg-primary-100 flex size-6 items-center justify-center rounded-full"
                  aria-label="Retirer 1"
                >
                  <Minus className="size-3" />
                </button>
                <span className="text-foreground min-w-[1.5ch] text-center text-xs font-semibold tabular-nums">
                  {item.quantity}
                </span>
                <button
                  type="button"
                  onClick={() =>
                    setItemQuantity(item.product_id, item.quantity + 1)
                  }
                  className="bg-primary-600 hover:bg-primary-700 flex size-6 items-center justify-center rounded-full text-white"
                  aria-label="Ajouter 1"
                >
                  <Plus className="size-3" />
                </button>
              </div>
              <button
                type="button"
                onClick={() => removeItem(item.product_id)}
                className="text-danger-600 text-[11px] hover:underline"
              >
                Retirer
              </button>
            </div>
          </li>
        ))}
      </ul>

      {/* Sous-total + CTA — desktop card / mobile sticky */}
      <div className="mt-4 hidden lg:block">
        <div className="border-border bg-surface rounded-[16px] border p-5">
          <Recap subtotal={subtotal} />
          <Link
            href="/checkout"
            className="bg-primary-600 hover:bg-primary-700 mt-4 flex items-center justify-center gap-2 rounded-[12px] px-4 py-3 text-sm font-semibold text-white"
          >
            Passer au checkout
            <ArrowRight className="size-4" />
          </Link>
        </div>
      </div>

      {/* Sticky bottom CTA mobile */}
      <div className={cn("fixed inset-x-0 bottom-16 z-30 px-4 pb-2 lg:hidden")}>
        <div className="border-border bg-surface mx-auto max-w-md rounded-[16px] border p-3 shadow-lg">
          <div className="flex items-center justify-between gap-2 px-1 pb-2">
            <span className="text-muted text-xs">Sous-total</span>
            <span className="text-foreground text-base font-bold tabular-nums">
              {formatDA(subtotal)}
            </span>
          </div>
          <Link
            href="/checkout"
            className="bg-primary-600 hover:bg-primary-700 flex w-full items-center justify-center gap-2 rounded-[12px] px-4 py-3 text-sm font-semibold text-white"
          >
            Passer au checkout
            <ArrowRight className="size-4" />
          </Link>
        </div>
      </div>
    </div>
  );
}

function Recap({ subtotal }: { subtotal: number }) {
  return (
    <dl className="space-y-1.5 text-sm">
      <Row label="Sous-total" value={formatDA(subtotal)} />
      <p className="text-muted pt-1 text-xs">
        Les promos, frais de service et cashback sont calculés au checkout
        (selon ton mode de paiement).
      </p>
    </dl>
  );
}

function Row({
  label,
  value,
  bold,
}: {
  label: string;
  value: string;
  bold?: boolean;
}) {
  return (
    <div className="flex items-center justify-between">
      <dt className={cn("text-muted", bold && "text-foreground font-semibold")}>
        {label}
      </dt>
      <dd
        className={cn(
          "tabular-nums",
          bold ? "text-foreground text-base font-bold" : "text-foreground"
        )}
      >
        {value}
      </dd>
    </div>
  );
}
