"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import {
  GripVertical,
  CheckSquare,
  Square,
  ImageOff,
  Copy,
  Pencil,
  Trash2,
  ArrowUp,
  ArrowDown,
} from "lucide-react";
import { useDroppable } from "@dnd-kit/core";
import { useSortable } from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import { cn, formatDA } from "@/lib/utils";
import {
  PRODUCT_UNIT_META,
  stockState,
  type Category,
  type ProductWithCategory,
} from "@/lib/types";
import { useConfirm } from "@/components/ui/confirm";
import { ActionNote, useActionNote } from "@/components/shared/action-note";
import {
  toggleProductAvailability,
  duplicateProduct,
  deleteProducts,
} from "@/app/(merchant)/catalog/actions";
import { NONE, type DragHandle } from "./catalog-shared";

/** Commandes de reclassement SANS glisser (repli compatible vieux WebView). */
type MoveControls = {
  isFirst: boolean;
  isLast: boolean;
  onUp: () => void;
  onDown: () => void;
  categories: Category[];
  currentCategoryId: string;
  onMoveToCategory: (categoryId: string | null) => void;
} | null;

const GRID_CLASS =
  "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 lg:gap-4 xl:grid-cols-5";

/**
 * Grille de produits. Le DndContext + SortableContext sont fournis par le
 * parent (vue groupée) pour permettre le déplacement ENTRE catégories : ici on
 * ne fait que rendre la grille, sortable ou non.
 */
export function ProductItems({
  products,
  draggable,
  showMoveControls,
  categories,
  onMoveProduct,
  onMoveProductToCategory,
  lowStockThreshold,
  selectMode,
  selected,
  onToggleSelect,
  onDeleted,
}: {
  products: ProductWithCategory[];
  draggable: boolean;
  /** Repli boutons (monter/descendre + déplacer vers…) — vue groupée + manuel. */
  showMoveControls?: boolean;
  categories?: Category[];
  onMoveProduct?: (id: string, dir: "up" | "down") => void;
  onMoveProductToCategory?: (id: string, categoryId: string | null) => void;
  lowStockThreshold: number;
  selectMode: boolean;
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
  onDeleted: (id: string) => void;
}) {
  // Commandes boutons par carte (position dans la catégorie courante = ordre du
  // tableau `products`, qui est exactement la liste de cette catégorie).
  const moveFor = (p: ProductWithCategory, index: number): MoveControls => {
    if (
      !showMoveControls ||
      selectMode ||
      !onMoveProduct ||
      !onMoveProductToCategory
    )
      return null;
    return {
      isFirst: index === 0,
      isLast: index === products.length - 1,
      onUp: () => onMoveProduct(p.id, "up"),
      onDown: () => onMoveProduct(p.id, "down"),
      categories: categories ?? [],
      currentCategoryId: p.category_id ?? NONE,
      onMoveToCategory: (catId) => onMoveProductToCategory(p.id, catId),
    };
  };

  const cardProps = (p: ProductWithCategory, index: number) => ({
    product: p,
    lowStockThreshold,
    selectMode,
    selected: selected.has(p.id),
    onToggleSelect: () => onToggleSelect(p.id),
    onDeleted,
    moveControls: moveFor(p, index),
  });

  return (
    <div className={GRID_CLASS}>
      {products.map((p, index) =>
        draggable ? (
          <SortableProduct key={p.id} id={p.id}>
            {(handle) => (
              <ProductCard {...cardProps(p, index)} dragHandle={handle} />
            )}
          </SortableProduct>
        ) : (
          <ProductCard key={p.id} {...cardProps(p, index)} dragHandle={null} />
        )
      )}
    </div>
  );
}

/**
 * Conteneur droppable d'une catégorie (toute la section, en-tête compris) :
 * cible de dépôt pour un produit glissé depuis une autre catégorie, même quand
 * la catégorie est repliée ou vide. Désactivé hors mode glisser-produits.
 */
export function DroppableCategory({
  id,
  active,
  children,
}: {
  id: string;
  active: boolean;
  children: React.ReactNode;
}) {
  const { setNodeRef, isOver } = useDroppable({ id, disabled: !active });
  return (
    <div
      ref={setNodeRef}
      className={cn(
        "rounded-lg transition-shadow",
        active && isOver && "ring-primary-400/70 ring-2"
      )}
    >
      {children}
    </div>
  );
}

function SortableProduct({
  id,
  children,
}: {
  id: string;
  children: (handle: DragHandle) => React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id });
  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 20 : undefined,
    opacity: isDragging ? 0.85 : undefined,
  };
  return (
    <div ref={setNodeRef} style={style}>
      {children({ attributes, listeners })}
    </div>
  );
}

function ProductCard({
  product,
  lowStockThreshold,
  selectMode,
  selected,
  onToggleSelect,
  onDeleted,
  dragHandle,
  moveControls,
}: {
  product: ProductWithCategory;
  lowStockThreshold: number;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onDeleted: (id: string) => void;
  dragHandle: DragHandle;
  moveControls?: MoveControls;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [available, setAvailable] = useState(product.is_available);
  // Image cassée (URL morte, ex. seed unsplash 404) → placeholder propre.
  const [imgError, setImgError] = useState(false);
  const [pending, startTransition] = useTransition();
  const [dupPending, startDup] = useTransition();
  const [delPending, startDel] = useTransition();
  const [note, setNote] = useActionNote();

  const stock = stockState(product.stock_qty, lowStockThreshold);

  function onToggle() {
    const next = !available;
    setAvailable(next);
    startTransition(async () => {
      const res = await toggleProductAvailability(product.id, next);
      // Succès : l'interrupteur reflète déjà l'état (optimiste) = feedback visuel.
      if (res?.error) {
        setAvailable(!next);
        setNote({ ok: false, text: res.error });
      }
    });
  }
  function onDuplicate() {
    startDup(async () => {
      const res = await duplicateProduct(product.id);
      if (res?.error || !res?.id) {
        setNote({ ok: false, text: res?.error ?? "Échec de la duplication." });
        return;
      }
      // Succès : navigation vers le nouveau produit = feedback visuel.
      router.push(`/catalog/${res.id}`);
    });
  }
  async function onDelete() {
    if (
      !(await confirm({
        title: `Supprimer « ${product.name_fr} » ?`,
        message: "Action irréversible.",
        confirmLabel: "Supprimer",
        danger: true,
      }))
    )
      return;
    startDel(async () => {
      const res = await deleteProducts([product.id]);
      if (res?.error) {
        setNote({ ok: false, text: res.error });
        return;
      }
      // Succès : la carte disparaît de la liste (onDeleted) = feedback visuel.
      onDeleted(product.id);
    });
  }

  return (
    <div
      className={cn(
        "border-border bg-surface group relative flex flex-col overflow-hidden rounded-lg border shadow-sm transition-shadow hover:shadow-md",
        selected && "ring-primary-500 ring-2"
      )}
    >
      {/* Poignée de déplacement */}
      {dragHandle && (
        <button
          type="button"
          className="bg-surface/90 text-muted hover:text-foreground absolute top-2 left-2 z-10 flex size-7 cursor-grab touch-none items-center justify-center rounded-full backdrop-blur active:cursor-grabbing"
          aria-label="Déplacer le produit"
          {...dragHandle.attributes}
          {...dragHandle.listeners}
        >
          <GripVertical className="size-4" />
        </button>
      )}

      {/* Checkbox sélection */}
      {selectMode && (
        <button
          type="button"
          onClick={onToggleSelect}
          aria-pressed={selected}
          className="bg-surface/90 absolute top-2 right-2 z-10 flex size-7 items-center justify-center rounded-full backdrop-blur"
        >
          {selected ? (
            <CheckSquare className="text-primary-600 size-5" />
          ) : (
            <Square className="text-muted size-5" />
          )}
        </button>
      )}

      {/* Image — ratio 4/3 (carte plus courte qu'un carré) */}
      <Link
        href={`/catalog/${product.id}`}
        className="bg-surface-3 relative block aspect-[4/3] w-full"
      >
        {product.image_url && !imgError ? (
          <Image
            src={product.image_url}
            alt={product.name_fr}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
            className={cn(
              "object-cover transition-opacity",
              (!available || stock === "out") && "opacity-40"
            )}
            onError={() => setImgError(true)}
          />
        ) : (
          <div className="text-subtle flex h-full w-full items-center justify-center">
            <ImageOff className="size-8" />
          </div>
        )}
        <div className="absolute bottom-2 left-2 flex flex-col gap-1">
          {!available && (
            <span className="bg-foreground/70 text-micro rounded-full px-2 py-0.5 font-medium text-white">
              Masqué
            </span>
          )}
          {stock === "out" && (
            <span className="bg-danger-600 text-micro rounded-full px-2 py-0.5 font-medium text-white">
              Épuisé
            </span>
          )}
          {stock === "low" && (
            <span className="bg-warning-500 text-micro rounded-full px-2 py-0.5 font-medium text-white">
              Stock bas · {product.stock_qty}
            </span>
          )}
        </div>
      </Link>

      {/* Infos — compactes : une ligne de nom, une ligne prix/stock */}
      <div className="flex flex-1 flex-col gap-1 p-2.5">
        <Link
          href={`/catalog/${product.id}`}
          className="text-body-sm line-clamp-1 leading-tight font-medium hover:underline"
        >
          {product.name_fr}
        </Link>
        <div className="mt-auto flex items-baseline justify-between gap-2 pt-0.5">
          <span className="text-foreground text-sm font-semibold">
            {formatDA(product.price_da)}
            <span className="text-subtle text-caption ml-1 font-normal">
              / {PRODUCT_UNIT_META[product.unit].short}
            </span>
          </span>
          {stock === "ok" && (
            <span className="text-subtle text-caption shrink-0 tabular-nums">
              {product.stock_qty} en stock
            </span>
          )}
        </div>
      </div>

      {/* Repli SANS glisser : monter/descendre dans la catégorie + déplacer vers
          une autre catégorie. Commandes natives (boutons + <select>) qui
          fonctionnent sur tout WebView, même quand le glisser-déposer échoue. */}
      {moveControls && (
        <div className="border-border divide-border grid grid-cols-[2.25rem_2.25rem_1fr] divide-x border-t">
          <button
            type="button"
            onClick={moveControls.onUp}
            disabled={moveControls.isFirst}
            title="Monter"
            aria-label="Monter"
            className="text-muted hover:bg-surface-2 hover:text-primary-700 flex h-9 items-center justify-center transition-colors disabled:opacity-30"
          >
            <ArrowUp className="size-4" />
          </button>
          <button
            type="button"
            onClick={moveControls.onDown}
            disabled={moveControls.isLast}
            title="Descendre"
            aria-label="Descendre"
            className="text-muted hover:bg-surface-2 hover:text-primary-700 flex h-9 items-center justify-center transition-colors disabled:opacity-30"
          >
            <ArrowDown className="size-4" />
          </button>
          <select
            value={moveControls.currentCategoryId}
            onChange={(e) =>
              moveControls.onMoveToCategory(
                e.target.value === NONE ? null : e.target.value
              )
            }
            title="Déplacer vers une catégorie"
            aria-label="Déplacer vers une catégorie"
            className="text-muted hover:bg-surface-2 h-9 w-full truncate bg-transparent px-2 text-xs font-medium focus:outline-none"
          >
            {moveControls.categories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.title}
              </option>
            ))}
            <option value={NONE}>Sans catégorie</option>
          </select>
        </div>
      )}

      {/* Actions — barre compacte UNIQUE (au lieu de deux lignes) : bascule
          disponibilité à gauche + dupliquer / modifier / supprimer en icônes.
          Divise par ~2 la hauteur du pied de carte. */}
      <div className="border-border divide-border grid grid-cols-[1fr_2.5rem_2.5rem_2.5rem] divide-x border-t">
        <button
          type="button"
          onClick={onToggle}
          disabled={pending}
          aria-pressed={available}
          title={available ? "Disponible" : "Masqué"}
          className="hover:bg-surface-2 flex h-10 items-center gap-2 px-2.5 text-xs font-medium transition-colors disabled:opacity-50"
        >
          <span
            className={cn(
              "relative h-4 w-7 shrink-0 rounded-full transition-colors",
              available ? "bg-success-500" : "bg-border-strong"
            )}
          >
            <span
              className={cn(
                "absolute top-0.5 size-3 rounded-full bg-white transition-all",
                available ? "left-3.5" : "left-0.5"
              )}
            />
          </span>
          <span
            className={cn(
              "hidden truncate sm:inline",
              available ? "text-success-700" : "text-muted"
            )}
          >
            {available ? "Dispo" : "Masqué"}
          </span>
        </button>
        <button
          type="button"
          onClick={onDuplicate}
          disabled={dupPending}
          title="Dupliquer"
          aria-label="Dupliquer"
          className="text-muted hover:bg-surface-2 hover:text-primary-700 flex h-10 items-center justify-center transition-colors disabled:opacity-50"
        >
          <Copy className="size-4" />
        </button>
        <Link
          href={`/catalog/${product.id}`}
          title="Modifier"
          aria-label="Modifier"
          className="text-muted hover:bg-surface-2 hover:text-primary-700 flex h-10 items-center justify-center transition-colors"
        >
          <Pencil className="size-4" />
        </Link>
        <button
          type="button"
          onClick={onDelete}
          disabled={delPending}
          title="Supprimer"
          aria-label="Supprimer"
          className="text-muted hover:bg-danger-50 hover:text-danger-600 flex h-10 items-center justify-center transition-colors disabled:opacity-50"
        >
          <Trash2 className="size-4" />
        </button>
      </div>
      <ActionNote note={note} className="px-2.5 pb-1.5" />
    </div>
  );
}
