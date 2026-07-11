"use client";

import { useState } from "react";
import Link from "next/link";
import {
  SlidersHorizontal,
  LayoutGrid,
  Rows3,
  CheckSquare,
  ChevronsDownUp,
  Trash2,
  X,
  PackageOpen,
  Package,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Button, buttonVariants } from "@/components/ui/button";
import type { Category } from "@/lib/types";
import { NONE } from "./catalog-shared";

export function ToolsMenu({
  grouped,
  onToggleGrouped,
  selectMode,
  onToggleSelectMode,
  canFold,
  allExpanded,
  onToggleFold,
}: {
  grouped: boolean;
  onToggleGrouped: () => void;
  selectMode: boolean;
  onToggleSelectMode: () => void;
  canFold: boolean;
  allExpanded: boolean;
  onToggleFold: () => void;
}) {
  const [open, setOpen] = useState(false);
  const item =
    "flex w-full items-center gap-2.5 rounded-[10px] px-3 py-2.5 text-left text-sm hover:bg-surface-2";

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        title="Outils"
        aria-expanded={open}
        className={cn(
          "flex size-11 items-center justify-center rounded-[12px] border transition-colors",
          selectMode
            ? "border-primary-600 bg-primary-50 text-primary-700"
            : "border-border-strong text-muted hover:bg-surface-2"
        )}
      >
        <SlidersHorizontal className="size-4" />
      </button>

      {open && (
        <>
          <div
            className="fixed inset-0 z-30"
            onClick={() => setOpen(false)}
            aria-hidden
          />
          {/* Ancré au bord de DÉBUT du bouton → le menu s'ouvre vers l'INTÉRIEUR
              (le bouton est à gauche de la barre sur mobile ; `right-0` faisait
              sortir le menu de 240px hors de l'écran à gauche). `start-0` reste
              correct en RTL. */}
          <div className="border-border bg-surface absolute start-0 z-40 mt-2 w-60 max-w-[calc(100vw-2rem)] rounded-[12px] border p-1 shadow-lg">
            <button
              type="button"
              className={item}
              onClick={() => {
                onToggleGrouped();
                setOpen(false);
              }}
            >
              {grouped ? (
                <LayoutGrid className="text-muted size-4" />
              ) : (
                <Rows3 className="text-muted size-4" />
              )}
              {grouped ? "Vue grille" : "Grouper par catégorie"}
            </button>
            <button
              type="button"
              className={cn(item, selectMode && "text-primary-700 font-medium")}
              onClick={() => {
                onToggleSelectMode();
                setOpen(false);
              }}
            >
              <CheckSquare
                className={cn(
                  "size-4",
                  selectMode ? "text-primary-600" : "text-muted"
                )}
              />
              {selectMode
                ? "Quitter la sélection multiple"
                : "Sélection multiple"}
            </button>
            {canFold && (
              <button
                type="button"
                className={item}
                onClick={() => {
                  onToggleFold();
                  setOpen(false);
                }}
              >
                <ChevronsDownUp
                  className={cn(
                    "text-muted size-4",
                    !allExpanded && "rotate-180"
                  )}
                />
                {allExpanded ? "Tout replier" : "Tout déplier"}
              </button>
            )}
          </div>
        </>
      )}
    </div>
  );
}

export function BulkBar({
  productCount,
  categoryCount,
  categories,
  onClear,
  onSetAvailability,
  onAssign,
  onDeleteProducts,
  onDeleteCategories,
}: {
  productCount: number;
  categoryCount: number;
  categories: Category[];
  onClear: () => void;
  onSetAvailability: (value: boolean) => void;
  onAssign: (categoryId: string) => void;
  onDeleteProducts: () => void;
  onDeleteCategories: () => void;
}) {
  return (
    <div className="fixed inset-x-0 bottom-0 z-40 px-4 pb-[max(1rem,env(safe-area-inset-bottom))] lg:bottom-4 lg:left-60 lg:pb-4">
      <div className="border-border bg-surface mx-auto flex max-w-3xl flex-wrap items-center gap-2 rounded-[16px] border p-3 shadow-lg">
        <span className="text-sm font-medium">
          {productCount > 0 &&
            `${productCount} produit${productCount > 1 ? "s" : ""}`}
          {productCount > 0 && categoryCount > 0 && " · "}
          {categoryCount > 0 &&
            `${categoryCount} catégorie${categoryCount > 1 ? "s" : ""}`}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {productCount > 0 && (
            <>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onSetAvailability(true)}
              >
                Rendre dispo
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={() => onSetAvailability(false)}
              >
                Masquer
              </Button>
              <select
                defaultValue=""
                onChange={(e) => {
                  if (e.target.value) onAssign(e.target.value);
                }}
                className="border-border-strong h-9 rounded-[10px] border bg-white px-2 text-xs focus:outline-none"
              >
                <option value="" disabled>
                  Assigner catégorie…
                </option>
                {categories.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.title}
                  </option>
                ))}
                <option value={NONE}>Aucune catégorie</option>
              </select>
              <Button
                size="sm"
                variant="destructive"
                onClick={onDeleteProducts}
              >
                <Trash2 className="size-4" />
                Supprimer
              </Button>
            </>
          )}
          {categoryCount > 0 && (
            <Button
              size="sm"
              variant="destructive"
              onClick={onDeleteCategories}
            >
              <Trash2 className="size-4" />
              Supprimer {categoryCount > 1 ? "catégories" : "catégorie"}
            </Button>
          )}
          <button
            type="button"
            onClick={onClear}
            title="Annuler la sélection"
            className="text-muted hover:text-foreground p-1.5"
          >
            <X className="size-4" />
          </button>
        </div>
      </div>
    </div>
  );
}

export function EmptyState() {
  return (
    <div className="border-border bg-surface flex flex-col items-center justify-center rounded-[16px] border border-dashed py-16 text-center">
      <div className="bg-primary-50 text-primary-600 mb-4 flex size-14 items-center justify-center rounded-2xl">
        <PackageOpen className="size-7" />
      </div>
      <h2 className="text-lg font-semibold">Votre catalogue est vide</h2>
      <p className="text-muted mt-1 mb-5 max-w-sm text-sm">
        Ajoutez vos produits pour qu&apos;ils apparaissent sur votre boutique et
        que les clients puissent commander.
      </p>
      <Link href="/catalog/new" className={buttonVariants()}>
        <Package className="size-4" />
        Ajouter mon premier produit
      </Link>
    </div>
  );
}
