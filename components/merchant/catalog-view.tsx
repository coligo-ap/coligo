"use client";

import Link from "next/link";
import Image from "next/image";
import { useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
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
  Tags,
  X,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
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
  bulkSetAvailability,
  bulkAssignCategory,
} from "@/app/(merchant)/catalog/actions";

const ALL = "__all__";
const NONE = "__none__";

type SortKey = "recent" | "price_asc" | "price_desc" | "name" | "stock";

const SORT_LABELS: Record<SortKey, string> = {
  recent: "Plus récents",
  price_asc: "Prix croissant",
  price_desc: "Prix décroissant",
  name: "Nom (A→Z)",
  stock: "Stock croissant",
};

export function CatalogView({
  products,
  categories,
  lowStockThreshold,
}: {
  products: ProductWithCategory[];
  categories: Category[];
  lowStockThreshold: number;
}) {
  const router = useRouter();
  const [query, setQuery] = useState("");
  const [categoryId, setCategoryId] = useState<string>(ALL);
  const [sort, setSort] = useState<SortKey>("recent");
  const [grouped, setGrouped] = useState(false);
  const [selectMode, setSelectMode] = useState(false);
  const [selected, setSelected] = useState<Set<string>>(new Set());

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const list = products.filter((p) => {
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
  }, [products, query, categoryId, sort]);

  function toggleSelect(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function clearSelection() {
    setSelected(new Set());
  }

  const availableCount = products.filter((p) => p.is_available).length;

  // Groupes pour la vue groupée.
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
    const ordered = categories
      .filter((c) => byCat.has(c.id))
      .map((c) => ({ title: c.title, items: byCat.get(c.id)! }));
    if (uncategorized.length > 0)
      ordered.push({ title: "Sans catégorie", items: uncategorized });
    return ordered;
  }, [grouped, filtered, categories]);

  return (
    <div className="mx-auto max-w-[1600px] p-4 lg:p-6 lg:px-8">
      {/* Header */}
      <header className="mb-5 flex flex-wrap items-end justify-between gap-3 lg:mb-6">
        <div>
          <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">
            Catalogue
          </h1>
          <p className="text-muted mt-1 text-sm">
            {products.length} produit{products.length > 1 ? "s" : ""} ·{" "}
            {availableCount} disponible{availableCount > 1 ? "s" : ""} ·{" "}
            {categories.length} catégorie{categories.length > 1 ? "s" : ""}
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          <Link
            href="/catalog/categories"
            className={buttonVariants({ variant: "outline" })}
          >
            <Tags className="size-4" />
            Catégories
          </Link>
          <Link href="/catalog/new" className={buttonVariants()}>
            <Plus className="size-4" />
            Nouveau produit
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

          <ToolToggle
            active={grouped}
            onClick={() => setGrouped((v) => !v)}
            title={grouped ? "Vue grille" : "Grouper par catégorie"}
          >
            {grouped ? (
              <LayoutGrid className="size-4" />
            ) : (
              <Rows3 className="size-4" />
            )}
          </ToolToggle>

          <ToolToggle
            active={selectMode}
            onClick={() => {
              setSelectMode((v) => !v);
              clearSelection();
            }}
            title="Sélection multiple"
          >
            <CheckSquare className="size-4" />
          </ToolToggle>
        </div>
      </div>

      {/* Chips catégories */}
      {categories.length > 0 && (
        <div className="-mx-1 mb-5 flex gap-1.5 overflow-x-auto px-1 pb-1 lg:flex-wrap lg:overflow-visible lg:pb-0">
          <CategoryChip
            label="Toutes"
            active={categoryId === ALL}
            onClick={() => setCategoryId(ALL)}
          />
          {categories.map((c) => (
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
      {products.length === 0 ? (
        <EmptyState />
      ) : filtered.length === 0 ? (
        <p className="text-muted py-12 text-center text-sm">
          Aucun produit ne correspond à votre recherche.
        </p>
      ) : groups ? (
        <div className="space-y-8">
          {groups.map((g) => (
            <section key={g.title}>
              <h2 className="mb-3 flex items-center gap-2 text-sm font-semibold">
                {g.title}
                <span className="text-subtle text-xs font-normal">
                  ({g.items.length})
                </span>
              </h2>
              <ProductGrid
                products={g.items}
                lowStockThreshold={lowStockThreshold}
                selectMode={selectMode}
                selected={selected}
                onToggleSelect={toggleSelect}
              />
            </section>
          ))}
        </div>
      ) : (
        <ProductGrid
          products={filtered}
          lowStockThreshold={lowStockThreshold}
          selectMode={selectMode}
          selected={selected}
          onToggleSelect={toggleSelect}
        />
      )}

      {/* Barre d'actions groupées */}
      {selected.size > 0 && (
        <BulkBar
          count={selected.size}
          categories={categories}
          onClear={clearSelection}
          onDone={() => {
            clearSelection();
            router.refresh();
          }}
          ids={Array.from(selected)}
        />
      )}
    </div>
  );
}

function ToolToggle({
  active,
  onClick,
  title,
  children,
}: {
  active: boolean;
  onClick: () => void;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      className={cn(
        "flex size-11 items-center justify-center rounded-[12px] border transition-colors",
        active
          ? "border-primary-600 bg-primary-50 text-primary-700"
          : "border-border-strong text-muted hover:bg-surface-2"
      )}
    >
      {children}
    </button>
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

function ProductGrid({
  products,
  lowStockThreshold,
  selectMode,
  selected,
  onToggleSelect,
}: {
  products: ProductWithCategory[];
  lowStockThreshold: number;
  selectMode: boolean;
  selected: Set<string>;
  onToggleSelect: (id: string) => void;
}) {
  return (
    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 lg:gap-4 xl:grid-cols-5">
      {products.map((p) => (
        <ProductCard
          key={p.id}
          product={p}
          lowStockThreshold={lowStockThreshold}
          selectMode={selectMode}
          selected={selected.has(p.id)}
          onToggleSelect={() => onToggleSelect(p.id)}
        />
      ))}
    </div>
  );
}

function ProductCard({
  product,
  lowStockThreshold,
  selectMode,
  selected,
  onToggleSelect,
}: {
  product: ProductWithCategory;
  lowStockThreshold: number;
  selectMode: boolean;
  selected: boolean;
  onToggleSelect: () => void;
}) {
  const [available, setAvailable] = useState(product.is_available);
  const [pending, startTransition] = useTransition();
  const [dupPending, startDup] = useTransition();

  const stock = stockState(product.stock_qty, lowStockThreshold);

  function onToggle() {
    const next = !available;
    setAvailable(next); // optimiste
    startTransition(async () => {
      const res = await toggleProductAvailability(product.id, next);
      if (res?.error) setAvailable(!next); // rollback
    });
  }

  function onDuplicate() {
    startDup(() => {
      void duplicateProduct(product.id);
    });
  }

  return (
    <div
      className={cn(
        "border-border bg-surface group relative flex flex-col overflow-hidden rounded-[16px] border shadow-sm transition-shadow hover:shadow-md",
        selected && "ring-primary-500 ring-2"
      )}
    >
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
        {/* Badges */}
        <div className="absolute top-2 left-2 flex flex-col gap-1">
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

      {/* Actions */}
      <div className="border-border flex items-center justify-between gap-2 border-t px-3 py-2">
        <button
          type="button"
          onClick={onToggle}
          disabled={pending}
          aria-pressed={available}
          className="inline-flex items-center gap-1.5 text-xs font-medium disabled:opacity-50"
        >
          <span
            className={cn(
              "relative h-4 w-7 rounded-full transition-colors",
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
          <span className={available ? "text-success-700" : "text-muted"}>
            {available ? "Dispo" : "Masqué"}
          </span>
        </button>

        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onDuplicate}
            disabled={dupPending}
            title="Dupliquer"
            className="text-muted hover:text-primary-700 inline-flex items-center p-1 disabled:opacity-50"
          >
            <Copy className="size-3.5" />
          </button>
          <Link
            href={`/catalog/${product.id}`}
            title="Modifier"
            className="text-muted hover:text-primary-700 inline-flex items-center p-1"
          >
            <Pencil className="size-3.5" />
          </Link>
        </div>
      </div>
    </div>
  );
}

function BulkBar({
  count,
  categories,
  ids,
  onClear,
  onDone,
}: {
  count: number;
  categories: Category[];
  ids: string[];
  onClear: () => void;
  onDone: () => void;
}) {
  const [pending, startTransition] = useTransition();

  function setAvailability(value: boolean) {
    startTransition(async () => {
      await bulkSetAvailability(ids, value);
      onDone();
    });
  }

  function assign(categoryId: string) {
    startTransition(async () => {
      await bulkAssignCategory(ids, categoryId === NONE ? null : categoryId);
      onDone();
    });
  }

  return (
    <div className="fixed inset-x-0 bottom-0 z-40 px-4 pb-4 lg:bottom-4 lg:left-60">
      <div className="border-border bg-surface mx-auto flex max-w-3xl flex-wrap items-center gap-2 rounded-[16px] border p-3 shadow-lg">
        <span className="text-sm font-medium">
          {count} sélectionné{count > 1 ? "s" : ""}
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => setAvailability(true)}
          >
            Rendre dispo
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={pending}
            onClick={() => setAvailability(false)}
          >
            Masquer
          </Button>
          <select
            defaultValue=""
            disabled={pending}
            onChange={(e) => {
              if (e.target.value) assign(e.target.value);
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
