"use client";

import { useState } from "react";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { cn } from "@/lib/utils";
import type { Category, Product } from "@/lib/types";
import type { LoadedOptionGroup } from "@/app/(merchant)/catalog/options/actions";
import { ProductForm, DeleteProduct } from "@/components/merchant/product-form";
import { ProductOptionsEditor } from "@/components/merchant/product-options-editor";

type Tab = "details" | "options";

/**
 * Coquille d'édition d'un produit avec **nav sous-page segmentée** (Détails ·
 * Options & variantes) plutôt qu'un long défilement. L'en-tête (retour + titre +
 * supprimer) est partagé ; les deux panneaux RESTENT MONTÉS (l'inactif est en
 * `hidden`) → aucune perte de saisie au changement d'onglet, et un léger fondu à
 * l'activation adoucit la transition.
 */
export function ProductEditTabs({
  merchantId,
  product,
  categories,
  initialGroups,
}: {
  merchantId: string;
  product: Product;
  categories: Category[];
  initialGroups: LoadedOptionGroup[];
}) {
  const [tab, setTab] = useState<Tab>("details");
  const optionCount = initialGroups.reduce((n, g) => n + g.options.length, 0);

  const tabs: { id: Tab; label: string; badge?: number }[] = [
    { id: "details", label: "Détails" },
    {
      id: "options",
      label: "Options & variantes",
      badge: optionCount || undefined,
    },
  ];

  return (
    <div>
      {/* Transition douce entre sous-pages (le panneau qui (ré)apparaît reçoit la
          classe `pe-panel` → l'animation rejoue à chaque activation). */}
      <style>{`@keyframes peFade{from{opacity:0;transform:translateY(6px)}to{opacity:1;transform:none}}.pe-panel{animation:peFade .18s ease}`}</style>

      {/* En-tête partagé : retour + titre + supprimer + nav */}
      <div className="mx-auto max-w-2xl px-4 pt-4 lg:px-8 lg:pt-6">
        <Link
          href="/catalog"
          className="text-muted hover:text-foreground mb-3 inline-flex items-center gap-1.5 text-sm"
        >
          <ArrowLeft className="size-4" />
          Retour au catalogue
        </Link>
        <div className="flex items-start justify-between gap-3">
          <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">
            Modifier le produit
          </h1>
          <DeleteProduct productId={product.id} />
        </div>

        {/* Nav sous-page segmentée */}
        <div className="border-border bg-surface-2 mt-4 inline-flex max-w-full gap-1 overflow-x-auto rounded-md border p-1">
          {tabs.map((tb) => (
            <button
              key={tb.id}
              type="button"
              onClick={() => setTab(tb.id)}
              aria-pressed={tab === tb.id}
              className={cn(
                "rounded-chip inline-flex shrink-0 items-center gap-1.5 px-3.5 py-2 text-sm font-medium transition-colors",
                tab === tb.id
                  ? "bg-surface text-foreground shadow-sm"
                  : "text-muted hover:text-foreground"
              )}
            >
              {tb.label}
              {tb.badge != null && (
                <span
                  className={cn(
                    "text-caption rounded-full px-1.5 py-0.5 font-semibold tabular-nums",
                    tab === tb.id
                      ? "bg-primary-50 text-primary-700"
                      : "bg-surface-3 text-muted"
                  )}
                >
                  {tb.badge}
                </span>
              )}
            </button>
          ))}
        </div>
      </div>

      {/* Panneaux : les deux restent montés (état préservé), l'inactif masqué. */}
      <div className={tab === "details" ? "pe-panel" : "hidden"}>
        <ProductForm
          merchantId={merchantId}
          product={product}
          categories={categories}
          hideHeader
        />
      </div>
      <div className={tab === "options" ? "pe-panel" : "hidden"}>
        <div className="mx-auto max-w-2xl px-4 pt-2 pb-10 lg:px-8">
          <ProductOptionsEditor
            productId={product.id}
            initialGroups={initialGroups}
            defaultOpen
          />
        </div>
      </div>
    </div>
  );
}
