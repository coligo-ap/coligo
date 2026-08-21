"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useTranslations } from "next-intl";
import { RotateCcw, ArrowRight, Check, Loader2 } from "lucide-react";
import { resolveReorder } from "@/app/(customer)/commandes/actions";
import { addItem, clearAllCarts } from "@/lib/customer/cart-store";

/**
 * « Commander à nouveau » — recompose le panier à partir d'une commande passée.
 * La résolution (noms snapshot → produits actuels) est faite côté serveur
 * (resolveReorder). Ici on vide les paniers, on ré-ajoute les articles encore
 * disponibles via le store panier, puis on propose d'aller au panier. Les
 * messages sont INLINE (cf. règle produit) : succès vert + articles
 * indisponibles éventuels, jamais de toast.
 */
export function ReorderButton({ orderId }: { orderId: string }) {
  const t = useTranslations("orders");
  const router = useRouter();
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{
    slug: string;
    count: number;
    missing: string[];
  } | null>(null);

  function handleReorder() {
    setError(null);
    setDone(null);
    start(async () => {
      const res = await resolveReorder(orderId);
      if (!res.ok) {
        setError(res.error);
        return;
      }
      // Panier mono-commerçant : on repart propre, puis on ré-ajoute.
      clearAllCarts();
      for (const it of res.items) {
        addItem(
          {
            id: res.merchant.id,
            slug: res.merchant.slug,
            name: res.merchant.name,
            logo_url: res.merchant.logo_url,
          },
          {
            product_id: it.product_id,
            name: it.name,
            unit: it.unit ?? null,
            min_qty: it.min_qty,
            max_qty: it.max_qty,
            unit_price_da: it.unit_price_da,
            image_url: it.image_url,
            category_title: it.category_title,
            quantity: it.quantity,
          }
        );
      }
      setDone({
        slug: res.merchant.slug,
        count: res.items.length,
        missing: res.missing,
      });
    });
  }

  if (done) {
    return (
      <div className="border-success-100 bg-success-50 mt-2.5 rounded-lg border p-3.5">
        <p className="text-success-800 text-body-sm flex items-center gap-1 font-bold">
          <Check className="size-3.5 shrink-0" strokeWidth={3} />
          {t("reorderAdded", { count: done.count })}
        </p>
        {done.missing.length > 0 && (
          <p className="text-muted text-label mt-1 font-medium">
            {t("reorderMissing", { names: done.missing.join(", ") })}
          </p>
        )}
        <button
          type="button"
          onClick={() => router.push(`/m/${done.slug}`)}
          className="bg-primary-600 hover:bg-primary-700 mt-3 inline-flex h-10 w-full items-center justify-center gap-1.5 rounded-md px-4 text-sm font-bold text-white transition-colors"
        >
          {t("reorderViewCart")}
          <ArrowRight className="size-4 rtl:-scale-x-100" />
        </button>
      </div>
    );
  }

  return (
    <div className="mt-2.5">
      <button
        type="button"
        onClick={handleReorder}
        disabled={pending}
        className="border-primary-200 text-primary-700 hover:bg-primary-50 rounded-card-lg inline-flex h-11 w-full items-center justify-center gap-2 border-[1.5px] bg-white px-4 text-sm font-bold transition-colors disabled:opacity-60"
      >
        {pending ? (
          <Loader2 className="size-4 animate-spin" />
        ) : (
          <RotateCcw className="size-4" />
        )}
        {t("reorder")}
      </button>
      {error && (
        <p className="text-danger-600 text-label-lg mt-2 text-center font-semibold">
          {error}
        </p>
      )}
    </div>
  );
}
