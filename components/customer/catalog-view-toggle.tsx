"use client";

import { useTranslations } from "next-intl";
import { LayoutGrid, Rows3 } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  setCatalogDisplay,
  useCatalogDisplay,
} from "@/lib/customer/catalog-display-store";

// =============================================================================
// CatalogViewToggle — bascule liste / catégories, posée sur la LIGNE du toggle
// Retrait/Livraison (gain de place). Pilote le catalogue via le store partagé ;
// masquée s'il n'y a qu'un seul groupe (rien à basculer).
// =============================================================================

export function CatalogViewToggle({
  merchantId,
  defaultDisplay,
}: {
  merchantId: string;
  defaultDisplay: "list" | "categories";
}) {
  const t = useTranslations("merchant");
  const { display: stored, groupsCount } = useCatalogDisplay();
  if (groupsCount <= 1) return null;
  const display = stored ?? defaultDisplay;

  function pick(v: "list" | "categories") {
    setCatalogDisplay(v);
    try {
      window.localStorage.setItem(`coligo:catalog-display:${merchantId}`, v);
    } catch {
      /* préférence non mémorisée, sans gravité */
    }
  }

  return (
    <div
      role="group"
      aria-label={t("viewToggleAria")}
      className="bg-surface-2 flex shrink-0 items-center self-stretch rounded-[16px] p-1 shadow-[inset_0_1px_3px_rgba(0,0,0,0.04)]"
    >
      {/* Boutons LARGES (profitent de la ligne) ; mode sélectionné = violet
          Coligo plein, icône blanche — l'état actif se voit d'un coup d'œil. */}
      <button
        type="button"
        onClick={() => pick("categories")}
        aria-pressed={display === "categories"}
        title={t("viewAsCategories")}
        className={cn(
          "flex h-full w-12 items-center justify-center rounded-[12px] transition-colors max-[399px]:w-9",
          display === "categories"
            ? "bg-primary-600 text-white shadow-[0_4px_12px_-2px_rgba(108,43,217,0.45)]"
            : "text-muted hover:text-foreground"
        )}
      >
        <LayoutGrid className="size-4" />
      </button>
      <button
        type="button"
        onClick={() => pick("list")}
        aria-pressed={display === "list"}
        title={t("viewAsList")}
        className={cn(
          "flex h-full w-12 items-center justify-center rounded-[12px] transition-colors max-[399px]:w-9",
          display === "list"
            ? "bg-primary-600 text-white shadow-[0_4px_12px_-2px_rgba(108,43,217,0.45)]"
            : "text-muted hover:text-foreground"
        )}
      >
        <Rows3 className="size-4" />
      </button>
    </div>
  );
}
