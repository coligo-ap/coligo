"use client";

import Link from "next/link";
import Image from "next/image";
import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { useConfirm } from "@/components/ui/confirm";
import {
  DndContext,
  closestCenter,
  PointerSensor,
  TouchSensor,
  useSensor,
  useSensors,
  type DragEndEvent,
} from "@dnd-kit/core";
import {
  SortableContext,
  verticalListSortingStrategy,
  rectSortingStrategy,
  useSortable,
  arrayMove,
} from "@dnd-kit/sortable";
import { CSS } from "@dnd-kit/utilities";
import {
  Plus,
  Search,
  Package,
  Pencil,
  ImageOff,
  PackageOpen,
  Copy,
  CheckSquare,
  Square,
  LayoutGrid,
  Rows3,
  X,
  ChevronDown,
  ChevronsDownUp,
  GripVertical,
  SlidersHorizontal,
  Trash2,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "@/components/ui/toast";
import { cn, formatDA } from "@/lib/utils";
import {
  PRODUCT_UNIT_META,
  stockState,
  type Category,
  type ProductWithCategory,
} from "@/lib/types";
import {
  toggleProductAvailability,
  duplicateProduct,
  deleteProducts,
  reorderProducts,
  bulkSetAvailability,
  bulkAssignCategory,
} from "@/app/(merchant)/catalog/actions";
import {
  reorderCategories,
  deleteCategories,
} from "@/app/(merchant)/catalog/categories/actions";

const ALL = "__all__";
const NONE = "__none__";

type SortKey =
  | "manual"
  | "recent"
  | "price_asc"
  | "price_desc"
  | "name"
  | "stock";

const SORT_LABELS: Record<SortKey, string> = {
  manual: "Manuel (glisser)",
  recent: "Plus récents",
  price_asc: "Prix croissant",
  price_desc: "Prix décroissant",
  name: "Nom (A→Z)",
  stock: "Stock bas d'abord",
};

export function CatalogView({
  products,
  categories,
  lowStockThreshold,
  onMutated,
}: {
  products: ProductWithCategory[];
  categories: Category[];
  lowStockThreshold: number;
  /** Après une mutation (suppression, réordonnancement…) : recharge la source.
   *  Fourni par CatalogLoader (invalide la requête TanStack) ; à défaut, repli
   *  sur router.refresh(). */
  onMutated?: () => void;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  // Porte unique de rafraîchissement après mutation (TanStack ou RSC).
  const refresh = onMutated ?? (() => router.refresh());

  // Copies locales (réordonnancement optimiste).
  const [cats, setCats] = useState(categories);
  const [prods, setProds] = useState(products);
  useEffect(() => setCats(categories), [categories]);
  useEffect(() => setProds(products), [products]);

  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState<string>(ALL);
  const [sort, setSort] = useState<SortKey>("manual");
  const [grouped, setGrouped] = useState(categories.length > 0);
  const [selectMode, setSelectMode] = useState(false);
  const [selProducts, setSelProducts] = useState<Set<string>>(new Set());
  const [selCats, setSelCats] = useState<Set<string>>(new Set());
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 8 },
    })
  );

  function toggleExpanded(key: string) {
    setExpanded((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }
  function toggleSelProduct(id: string) {
    setSelProducts((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function toggleSelCat(id: string) {
    setSelCats((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }
  function clearSelection() {
    setSelProducts(new Set());
    setSelCats(new Set());
  }
  function selectAllInCategory(ids: string[]) {
    setSelProducts((prev) => {
      const next = new Set(prev);
      const allSelected = ids.every((id) => next.has(id));
      for (const id of ids) {
        if (allSelected) next.delete(id);
        else next.add(id);
      }
      return next;
    });
  }

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = prods.filter((p) => {
      if (categoryId === NONE && p.category_id) return false;
      if (
        categoryId !== ALL &&
        categoryId !== NONE &&
        p.category_id !== categoryId
      )
        return false;
      if (!q) return true;
      return (
        p.name_fr.toLowerCase().includes(q) ||
        (p.name_ar ?? "").toLowerCase().includes(q) ||
        (p.categories?.title ?? "").toLowerCase().includes(q)
      );
    });

    if (sort === "manual") return list; // ordre du tableau (= position serveur)

    const sorted = [...list];
    sorted.sort((a, b) => {
      switch (sort) {
        case "price_asc":
          return a.price_da - b.price_da;
        case "price_desc":
          return b.price_da - a.price_da;
        case "name":
          return a.name_fr.localeCompare(b.name_fr, "fr");
        case "stock":
          return (a.stock_qty ?? Infinity) - (b.stock_qty ?? Infinity);
        default:
          return b.created_at.localeCompare(a.created_at);
      }
    });
    return sorted;
  }, [prods, query, categoryId, sort]);

  const groups = useMemo(() => {
    if (!grouped) return null;
    const byCat = new Map<string, ProductWithCategory[]>();
    const uncategorized: ProductWithCategory[] = [];
    for (const p of filtered) {
      if (!p.category_id) uncategorized.push(p);
      else {
        if (!byCat.has(p.category_id)) byCat.set(p.category_id, []);
        byCat.get(p.category_id)!.push(p);
      }
    }
    const showEmpty = query.trim() === "" && categoryId === ALL;
    const ordered = cats
      .filter((c) => showEmpty || byCat.has(c.id))
      .map((c) => ({
        key: c.id,
        title: c.title,
        image: c.image_url,
        items: byCat.get(c.id) ?? [],
      }));
    if (uncategorized.length > 0)
      ordered.push({
        key: NONE,
        title: "Sans catégorie",
        image: null,
        items: uncategorized,
      });
    return ordered;
  }, [grouped, filtered, cats, query, categoryId]);

  const allExpanded =
    !!groups && groups.length > 0 && groups.every((g) => expanded.has(g.key));
  function toggleAll() {
    if (!groups) return;
    setExpanded(allExpanded ? new Set() : new Set(groups.map((g) => g.key)));
  }

  // DnD : produits réordonnables en vue groupée, tri manuel, hors sélection.
  const productsDraggable = grouped && sort === "manual" && !selectMode;
  // DnD : catégories réordonnables en vue groupée, hors sélection.
  const categoriesDraggable = grouped && !selectMode;

  function onReorderProducts(ids: string[]) {
    setProds((prev) => {
      const set = new Set(ids);
      const map = new Map(prev.map((p) => [p.id, p]));
      const reordered = ids.map((id) => map.get(id)!);
      const others = prev.filter((p) => !set.has(p.id));
      return [...reordered, ...others];
    });
    startTransition(async () => {
      const res = await reorderProducts(ids);
      if (res?.error) toast.error(res.error);
    });
  }

  function onCategoryDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldI = cats.findIndex((c) => c.id === active.id);
    const newI = cats.findIndex((c) => c.id === over.id);
    if (oldI === -1 || newI === -1) return;
    const next = arrayMove(cats, oldI, newI);
    setCats(next);
    startTransition(async () => {
      const res = await reorderCategories(next.map((c) => c.id));
      if (res?.error) toast.error(res.error);
    });
  }

  async function deleteSelectedProducts() {
    const ids = Array.from(selProducts);
    if (
      !(await confirm({
        title: `Supprimer ${ids.length} produit${ids.length > 1 ? "s" : ""} ?`,
        message: "Action irréversible.",
        confirmLabel: "Supprimer",
        danger: true,
      }))
    )
      return;
    startTransition(async () => {
      const res = await deleteProducts(ids);
      if (res?.error) {
        toast.error(res.error);
        return;
      }
      toast.success(
        `${ids.length} produit${ids.length > 1 ? "s" : ""} supprimé${ids.length > 1 ? "s" : ""}`
      );
      clearSelection();
      refresh();
    });
  }
  async function deleteSelectedCategories() {
    const ids = Array.from(selCats);
    if (
      !(await confirm({
        title: `Supprimer ${ids.length} catégorie${ids.length > 1 ? "s" : ""} ?`,
        message: "Les produits liés deviendront « sans catégorie ».",
        confirmLabel: "Supprimer",
        danger: true,
      }))
    )
      return;
    startTransition(async () => {
      const res = await deleteCategories(ids);
      if (res?.error) {
        toast.error(res.error);
        return;
      }
      toast.success(
        `${ids.length} catégorie${ids.length > 1 ? "s" : ""} supprimée${ids.length > 1 ? "s" : ""}`
      );
      clearSelection();
      refresh();
    });
  }
  function bulk(
    fn: () => Promise<{ error?: string } | void>,
    successMsg: string
  ) {
    startTransition(async () => {
      const res = await fn();
      if (res?.error) {
        toast.error(res.error);
        return;
      }
      toast.success(successMsg);
      clearSelection();
      refresh();
    });
  }

  const availableCount = prods.filter((p) => p.is_available).length;
  const sortableCatKeys = (groups ?? [])
    .filter((g) => g.key !== NONE)
    .map((g) => g.key);

  return (
    <div className="mx-auto max-w-[1600px] p-4 lg:p-6 lg:px-8">
      {/* Header */}
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3 lg:mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">
            Catalogue
          </h1>
          <p className="text-muted mt-1 text-sm">
            {prods.length} produit{prods.length > 1 ? "s" : ""} ·{" "}
            {availableCount} disponible{availableCount > 1 ? "s" : ""} ·{" "}
            {cats.length} catégorie
            {cats.length > 1 ? "s" : ""}
          </p>
        </div>
        {/* Sur mobile : les deux boutons sur la MÊME ligne (50/50) pour gagner
            de la place ; libellés raccourcis. Sur ≥sm : libellés complets. */}
        <div className="flex w-full gap-2 sm:w-auto">
          <Link
            href="/catalog/categories/new"
            className={cn(
              buttonVariants({ variant: "outline" }),
              "flex-1 justify-center sm:flex-initial"
            )}
          >
            <Plus className="size-4" />
            <span className="sm:hidden">Catégorie</span>
            <span className="hidden sm:inline">Nouvelle catégorie</span>
          </Link>
          <Link
            href="/catalog/new"
            className={cn(
              buttonVariants(),
              "flex-1 justify-center sm:flex-initial"
            )}
          >
            <Plus className="size-4" />
            <span className="sm:hidden">Produit</span>
            <span className="hidden sm:inline">Nouveau produit</span>
          </Link>
        </div>
      </header>

      {/* Barre recherche + outils */}
      <div className="mb-4 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1 lg:max-w-md">
          <Search className="text-subtle pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            type="search"
            placeholder="Rechercher un produit ou une catégorie…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        <div className="flex items-center gap-2">
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="border-border-strong focus:ring-primary-400 h-11 rounded-[12px] border bg-white px-3 text-sm focus:ring-2 focus:outline-none"
          >
            {(Object.keys(SORT_LABELS) as SortKey[]).map((k) => (
              <option key={k} value={k}>
                {SORT_LABELS[k]}
              </option>
            ))}
          </select>

          {/* Outils secondaires regroupés dans UN menu (la barre restait
              chargée sur mobile avec 3 boutons toujours visibles). */}
          <ToolsMenu
            grouped={grouped}
            onToggleGrouped={() => setGrouped((v) => !v)}
            selectMode={selectMode}
            onToggleSelectMode={() => {
              setSelectMode((v) => !v);
              clearSelection();
            }}
            canFold={Boolean(grouped && groups && groups.length > 0)}
            allExpanded={allExpanded}
            onToggleFold={toggleAll}
          />
        </div>
      </div>

      {/* Bandeau mode sélection : rappel visible + sortie en un tap. */}
      {selectMode && selProducts.size === 0 && selCats.size === 0 && (
        <div className="border-primary-200 bg-primary-50 text-primary-800 mb-4 flex items-center justify-between gap-2 rounded-[12px] border px-3 py-2 text-sm">
          <span>Touchez des produits pour les sélectionner.</span>
          <button
            type="button"
            onClick={() => {
              setSelectMode(false);
              clearSelection();
            }}
            className="hover:bg-primary-100 rounded-[8px] px-2 py-1 text-xs font-semibold"
          >
            Quitter
          </button>
        </div>
      )}

      {/* Chips catégories */}
      {cats.length > 0 && (
        <div className="-mx-1 mb-5 flex gap-1.5 overflow-x-auto px-1 pb-1 lg:flex-wrap lg:overflow-visible lg:pb-0">
          <CategoryChip
            label="Toutes"
            active={categoryId === ALL}
            onClick={() => setCategoryId(ALL)}
          />
          {cats.map((c) => (
            <CategoryChip
              key={c.id}
              label={c.title}
              active={categoryId === c.id}
              onClick={() => setCategoryId(c.id)}
            />
          ))}
          <CategoryChip
            label="Sans catégorie"
            active={categoryId === NONE}
            onClick={() => setCategoryId(NONE)}
          />
        </div>
      )}

      {/* Contenu */}
      {prods.length === 0 ? (
        <EmptyState />
      ) : filtered.length === 0 ? (
        <p className="text-muted py-12 text-center text-sm">
          Aucun produit ne correspond à votre recherche.
        </p>
      ) : groups ? (
        <DndContext
          sensors={sensors}
          collisionDetection={closestCenter}
          onDragEnd={onCategoryDragEnd}
        >
          <SortableContext
            items={sortableCatKeys}
            strategy={verticalListSortingStrategy}
          >
            <div className="space-y-3">
              {groups.map((g) => {
                const ids = g.items.map((p) => p.id);
                const allSel =
                  ids.length > 0 && ids.every((id) => selProducts.has(id));
                return (
                  <SortableCategory
                    key={g.key}
                    id={g.key}
                    sortable={categoriesDraggable && g.key !== NONE}
                  >
                    {(handle) => (
                      <CategorySection
                        title={g.title}
                        image={g.image}
                        count={g.items.length}
                        open={expanded.has(g.key)}
                        onToggle={() => toggleExpanded(g.key)}
                        editHref={
                          g.key !== NONE ? `/catalog/categories/${g.key}` : null
                        }
                        addHref={
                          g.key !== NONE
                            ? `/catalog/new?category=${g.key}`
                            : "/catalog/new"
                        }
                        selectMode={selectMode}
                        selectable={g.key !== NONE}
                        selected={selCats.has(g.key)}
                        onToggleSelect={() => toggleSelCat(g.key)}
                        onDelete={
                          g.key !== NONE
                            ? async () => {
                                if (
                                  await confirm({
                                    title: "Supprimer cette catégorie ?",
                                    message:
                                      "Les produits liés deviendront « sans catégorie ».",
                                    confirmLabel: "Supprimer",
                                    danger: true,
                                  })
                                )
                                  bulk(
                                    () => deleteCategories([g.key]),
                                    "Catégorie supprimée"
                                  );
                              }
                            : null
                        }
                        dragHandle={handle}
                      >
                        {selectMode && ids.length > 0 && (
                          <button
                            type="button"
                            onClick={() => selectAllInCategory(ids)}
                            className="text-primary-700 hover:bg-primary-50 mb-3 inline-flex items-center gap-1.5 rounded-[8px] px-2 py-1 text-xs font-medium"
                          >
                            {allSel ? (
                              <CheckSquare className="size-4" />
                            ) : (
                              <Square className="size-4" />
                            )}
                            {allSel
                              ? "Tout désélectionner"
                              : "Tout sélectionner"}
                          </button>
                        )}
                        {g.items.length === 0 ? (
                          <p className="text-muted py-4 text-center text-sm">
                            Aucun produit dans cette catégorie.
                          </p>
                        ) : (
                          <ProductItems
                            products={g.items}
                            draggable={productsDraggable}
                            onReorder={onReorderProducts}
                            lowStockThreshold={lowStockThreshold}
                            selectMode={selectMode}
                            selected={selProducts}
                            onToggleSelect={toggleSelProduct}
                            onDeleted={refresh}
                          />
                        )}
                      </CategorySection>
                    )}
                  </SortableCategory>
                );
              })}
            </div>
          </SortableContext>
        </DndContext>
      ) : (
        <ProductItems
          products={filtered}
          draggable={false}
          onReorder={onReorderProducts}
          lowStockThreshold={lowStockThreshold}
          selectMode={selectMode}
          selected={selProducts}
          onToggleSelect={toggleSelProduct}
          onDeleted={refresh}
        />
      )}

      {/* Barre d'actions groupées */}
      {(selProducts.size > 0 || selCats.size > 0) && (
        <BulkBar
          productCount={selProducts.size}
          categoryCount={selCats.size}
          categories={cats}
          onClear={clearSelection}
          onSetAvailability={(v) =>
            bulk(
              () => bulkSetAvailability(Array.from(selProducts), v),
              v ? "Produits rendus disponibles" : "Produits masqués"
            )
          }
          onAssign={(catId) =>
            bulk(
              () =>
                bulkAssignCategory(
                  Array.from(selProducts),
                  catId === NONE ? null : catId
                ),
              "Catégorie assignée"
            )
          }
          onDeleteProducts={deleteSelectedProducts}
          onDeleteCategories={deleteSelectedCategories}
        />
      )}
    </div>
  );
}

/**
 * Menu « Outils » : regroupe les options secondaires (vue groupée/grille,
 * sélection multiple, tout déplier/replier) derrière un seul bouton pour
 * alléger la barre, surtout sur mobile.
 */
function ToolsMenu({
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
          <div className="border-border bg-surface absolute right-0 z-40 mt-2 w-60 rounded-[12px] border p-1 shadow-lg">
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

function CategoryChip({
  label,
  active,
  onClick,
}: {
  label: string;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "rounded-full border px-3 py-1.5 text-xs font-medium whitespace-nowrap transition-colors",
        active
          ? "border-primary-600 bg-primary-600 text-white"
          : "border-border-strong text-muted hover:bg-surface-2"
      )}
    >
      {label}
    </button>
  );
}

type DragHandle = Pick<
  ReturnType<typeof useSortable>,
  "attributes" | "listeners"
> | null;

function SortableCategory({
  id,
  sortable,
  children,
}: {
  id: string;
  sortable: boolean;
  children: (handle: DragHandle) => React.ReactNode;
}) {
  const {
    attributes,
    listeners,
    setNodeRef,
    transform,
    transition,
    isDragging,
  } = useSortable({ id, disabled: !sortable });

  const style = {
    transform: CSS.Transform.toString(transform),
    transition,
    zIndex: isDragging ? 20 : undefined,
    opacity: isDragging ? 0.85 : undefined,
  };

  return (
    <div ref={setNodeRef} style={style}>
      {children(sortable ? { attributes, listeners } : null)}
    </div>
  );
}

function CategorySection({
  title,
  image,
  count,
  open,
  onToggle,
  editHref,
  addHref,
  selectMode,
  selectable,
  selected,
  onToggleSelect,
  onDelete,
  dragHandle,
  children,
}: {
  title: string;
  image: string | null;
  count: number;
  open: boolean;
  onToggle: () => void;
  editHref: string | null;
  addHref: string;
  selectMode: boolean;
  selectable: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onDelete: (() => void) | null;
  dragHandle: DragHandle;
  children: React.ReactNode;
}) {
  return (
    <section
      className={cn(
        "border-border bg-surface overflow-hidden rounded-[16px] border",
        selected && "ring-primary-500 ring-2"
      )}
    >
      <div className="hover:bg-surface-2 flex items-center gap-2 px-3 py-2.5 transition-colors">
        {dragHandle && (
          <button
            type="button"
            className="text-subtle hover:text-foreground -ml-1 cursor-grab touch-none active:cursor-grabbing"
            aria-label="Déplacer la catégorie"
            {...dragHandle.attributes}
            {...dragHandle.listeners}
          >
            <GripVertical className="size-4" />
          </button>
        )}

        {selectMode && selectable && (
          <button
            type="button"
            onClick={onToggleSelect}
            aria-pressed={selected}
            className="inline-flex items-center"
          >
            {selected ? (
              <CheckSquare className="text-primary-600 size-5" />
            ) : (
              <Square className="text-muted size-5" />
            )}
          </button>
        )}

        <button
          type="button"
          onClick={onToggle}
          aria-expanded={open}
          className="flex min-w-0 flex-1 items-center gap-3 text-left"
        >
          <div className="bg-surface-3 relative size-9 shrink-0 overflow-hidden rounded-[8px]">
            {image ? (
              <Image
                src={image}
                alt={title}
                fill
                sizes="36px"
                className="object-cover"
              />
            ) : (
              <span className="text-subtle flex h-full items-center justify-center">
                <ImageOff className="size-4" />
              </span>
            )}
          </div>
          <span className="truncate text-sm font-semibold">{title}</span>
          <span className="bg-surface-3 text-muted rounded-full px-2 py-0.5 text-[11px] font-medium tabular-nums">
            {count}
          </span>
        </button>

        <Link
          href={addHref}
          title="Ajouter un produit à cette catégorie"
          className="border-border-strong text-primary-700 hover:bg-primary-50 inline-flex h-9 items-center gap-1 rounded-[10px] border px-2.5 text-xs font-medium"
        >
          <Plus className="size-4" />
          <span className="hidden sm:inline">Produit</span>
        </Link>
        {editHref && (
          <Link
            href={editHref}
            title="Modifier la catégorie"
            className="text-muted hover:bg-surface-3 hover:text-foreground inline-flex size-9 items-center justify-center rounded-[10px]"
          >
            <Pencil className="size-4" />
          </Link>
        )}
        {onDelete && (
          <button
            type="button"
            onClick={onDelete}
            title="Supprimer la catégorie"
            className="text-muted hover:bg-danger-50 hover:text-danger-600 inline-flex size-9 items-center justify-center rounded-[10px]"
          >
            <Trash2 className="size-4" />
          </button>
        )}

        <button
          type="button"
          onClick={onToggle}
          aria-label={open ? "Replier" : "Déplier"}
          className="text-muted hover:bg-surface-3 ml-0.5 inline-flex size-9 items-center justify-center rounded-[10px]"
        >
          <ChevronDown
            className={cn("size-5 transition-transform", open && "rotate-180")}
          />
        </button>
      </div>

      {open && <div className="px-4 pt-1 pb-4">{children}</div>}
    </section>
  );
}

const GRID_CLASS =
  "grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 lg:gap-4 xl:grid-cols-5";

function ProductItems({
  products,
  draggable,
  onReorder,
  lowStockThreshold,
  selectMode,
  selected,
  onToggleSelect,
  onDeleted,
}: {
  products: ProductWithCategory[];
  draggable: boolean;
  onReorder: (ids: string[]) => void;
  lowStockThreshold: number;
  selectMode: boolean;
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
  onDeleted: () => void;
}) {
  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 6 } }),
    useSensor(TouchSensor, {
      activationConstraint: { delay: 200, tolerance: 8 },
    })
  );

  const cardProps = (p: ProductWithCategory) => ({
    product: p,
    lowStockThreshold,
    selectMode,
    selected: selected.has(p.id),
    onToggleSelect: () => onToggleSelect(p.id),
    onDeleted,
  });

  if (!draggable) {
    return (
      <div className={GRID_CLASS}>
        {products.map((p) => (
          <ProductCard key={p.id} {...cardProps(p)} dragHandle={null} />
        ))}
      </div>
    );
  }

  const ids = products.map((p) => p.id);
  function onDragEnd(e: DragEndEvent) {
    const { active, over } = e;
    if (!over || active.id === over.id) return;
    const oldI = ids.indexOf(active.id as string);
    const newI = ids.indexOf(over.id as string);
    if (oldI === -1 || newI === -1) return;
    onReorder(arrayMove(ids, oldI, newI));
  }

  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCenter}
      onDragEnd={onDragEnd}
    >
      <SortableContext items={ids} strategy={rectSortingStrategy}>
        <div className={GRID_CLASS}>
          {products.map((p) => (
            <SortableProduct key={p.id} id={p.id}>
              {(handle) => (
                <ProductCard {...cardProps(p)} dragHandle={handle} />
              )}
            </SortableProduct>
          ))}
        </div>
      </SortableContext>
    </DndContext>
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
}: {
  product: ProductWithCategory;
  lowStockThreshold: number;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onDeleted: () => void;
  dragHandle: DragHandle;
}) {
  const router = useRouter();
  const confirm = useConfirm();
  const [available, setAvailable] = useState(product.is_available);
  const [pending, startTransition] = useTransition();
  const [dupPending, startDup] = useTransition();
  const [delPending, startDel] = useTransition();

  const stock = stockState(product.stock_qty, lowStockThreshold);

  function onToggle() {
    const next = !available;
    setAvailable(next);
    startTransition(async () => {
      const res = await toggleProductAvailability(product.id, next);
      if (res?.error) {
        setAvailable(!next);
        toast.error(res.error);
        return;
      }
      toast.success(next ? "Produit disponible" : "Produit masqué");
    });
  }
  function onDuplicate() {
    startDup(async () => {
      const res = await duplicateProduct(product.id);
      if (res?.error || !res?.id) {
        toast.error(res?.error ?? "Échec de la duplication.");
        return;
      }
      toast.success("Produit dupliqué");
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
        toast.error(res.error);
        return;
      }
      toast.success("Produit supprimé");
      onDeleted();
    });
  }

  return (
    <div
      className={cn(
        "border-border bg-surface group relative flex flex-col overflow-hidden rounded-[16px] border shadow-sm transition-shadow hover:shadow-md",
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

      {/* Image */}
      <Link
        href={`/catalog/${product.id}`}
        className="bg-surface-3 relative block aspect-square w-full"
      >
        {product.image_url ? (
          <Image
            src={product.image_url}
            alt={product.name_fr}
            fill
            sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 20vw"
            className={cn(
              "object-cover transition-opacity",
              (!available || stock === "out") && "opacity-40"
            )}
          />
        ) : (
          <div className="text-subtle flex h-full w-full items-center justify-center">
            <ImageOff className="size-8" />
          </div>
        )}
        <div className="absolute bottom-2 left-2 flex flex-col gap-1">
          {!available && (
            <span className="bg-foreground/70 rounded-full px-2 py-0.5 text-[10px] font-medium text-white">
              Masqué
            </span>
          )}
          {stock === "out" && (
            <span className="bg-danger-600 rounded-full px-2 py-0.5 text-[10px] font-medium text-white">
              Épuisé
            </span>
          )}
          {stock === "low" && (
            <span className="bg-warning-500 rounded-full px-2 py-0.5 text-[10px] font-medium text-white">
              Stock bas · {product.stock_qty}
            </span>
          )}
        </div>
      </Link>

      {/* Infos */}
      <div className="flex flex-1 flex-col gap-1 p-3">
        {product.categories?.title && (
          <span className="text-subtle truncate text-[10px] tracking-wide uppercase">
            {product.categories.title}
          </span>
        )}
        <Link
          href={`/catalog/${product.id}`}
          className="line-clamp-2 text-sm leading-snug font-medium hover:underline"
        >
          {product.name_fr}
        </Link>
        <div className="mt-auto flex items-end justify-between pt-1">
          <div className="text-foreground text-sm font-semibold">
            {formatDA(product.price_da)}
            <span className="text-subtle ml-1 text-xs font-normal">
              / {PRODUCT_UNIT_META[product.unit].short}
            </span>
          </div>
          {stock === "ok" && (
            <span className="text-subtle text-[11px] tabular-nums">
              {product.stock_qty} en stock
            </span>
          )}
        </div>
      </div>

      {/* Actions — disposées pour des zones de touche larges et espacées */}
      {/* Ligne 1 : disponibilité (toute la largeur) */}
      <button
        type="button"
        onClick={onToggle}
        disabled={pending}
        aria-pressed={available}
        className="border-border hover:bg-surface-2 flex h-11 w-full items-center gap-2 border-t px-3 text-xs font-medium transition-colors disabled:opacity-50"
      >
        <span
          className={cn(
            "relative h-5 w-9 shrink-0 rounded-full transition-colors",
            available ? "bg-success-500" : "bg-border-strong"
          )}
        >
          <span
            className={cn(
              "absolute top-0.5 size-4 rounded-full bg-white transition-all",
              available ? "left-4.5" : "left-0.5"
            )}
          />
        </span>
        <span className={available ? "text-success-700" : "text-muted"}>
          {available ? "Disponible" : "Masqué"}
        </span>
      </button>

      {/* Ligne 2 : dupliquer / modifier / supprimer (3 grandes cellules) */}
      <div className="border-border divide-border grid grid-cols-3 divide-x border-t">
        <button
          type="button"
          onClick={onDuplicate}
          disabled={dupPending}
          title="Dupliquer"
          className="text-muted hover:bg-surface-2 hover:text-primary-700 flex h-11 items-center justify-center gap-1.5 text-xs font-medium transition-colors disabled:opacity-50"
        >
          <Copy className="size-4" />
          <span className="hidden lg:inline">Dupliquer</span>
        </button>
        <Link
          href={`/catalog/${product.id}`}
          title="Modifier"
          className="text-muted hover:bg-surface-2 hover:text-primary-700 flex h-11 items-center justify-center gap-1.5 text-xs font-medium transition-colors"
        >
          <Pencil className="size-4" />
          <span className="hidden lg:inline">Modifier</span>
        </Link>
        <button
          type="button"
          onClick={onDelete}
          disabled={delPending}
          title="Supprimer"
          className="text-muted hover:bg-danger-50 hover:text-danger-600 flex h-11 items-center justify-center gap-1.5 text-xs font-medium transition-colors disabled:opacity-50"
        >
          <Trash2 className="size-4" />
          <span className="hidden lg:inline">Suppr.</span>
        </button>
      </div>
    </div>
  );
}

function BulkBar({
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
    <div className="fixed inset-x-0 bottom-0 z-40 px-4 pb-4 lg:bottom-4 lg:left-60">
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

function EmptyState() {
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
