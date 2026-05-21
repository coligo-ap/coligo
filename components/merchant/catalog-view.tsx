"use client";

import Link from "next/link";
import Image from "next/image";
import { useMemo, useState, useTransition } from "react";
import {
  Plus,
  Search,
  Package,
  Pencil,
  ImageOff,
  PackageOpen,
} from "lucide-react";
import { buttonVariants } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn, formatDA } from "@/lib/utils";
import { PRODUCT_UNIT_META, type Product } from "@/lib/types";
import { toggleProductAvailability } from "@/app/(merchant)/catalog/actions";

const ALL = "__all__";

export function CatalogView({ products }: { products: Product[] }) {
  const [query, setQuery] = useState("");
  const [category, setCategory] = useState<string>(ALL);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const p of products) if (p.category) set.add(p.category);
    return Array.from(set).sort((a, b) => a.localeCompare(b, "fr"));
  }, [products]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return products.filter((p) => {
      if (category !== ALL && p.category !== category) return false;
      if (!q) return true;
      return (
        p.name_fr.toLowerCase().includes(q) ||
        (p.name_ar ?? "").toLowerCase().includes(q) ||
        (p.category ?? "").toLowerCase().includes(q)
      );
    });
  }, [products, query, category]);

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
            {products.filter((p) => p.is_available).length} disponible
            {products.filter((p) => p.is_available).length > 1 ? "s" : ""}
          </p>
        </div>
        <Link href="/catalog/new" className={buttonVariants()}>
          <Plus className="size-4" />
          Nouveau produit
        </Link>
      </header>

      {/* Barre recherche + filtres */}
      <div className="mb-5 flex flex-col gap-3 lg:flex-row lg:items-center">
        <div className="relative flex-1 lg:max-w-md">
          <Search className="text-subtle pointer-events-none absolute top-1/2 left-3 size-4 -translate-y-1/2" />
          <Input
            type="search"
            placeholder="Rechercher un produit…"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            className="pl-9"
          />
        </div>

        {categories.length > 0 && (
          <div className="-mx-1 flex gap-1.5 overflow-x-auto px-1 pb-1 lg:flex-wrap lg:overflow-visible lg:pb-0">
            <CategoryChip
              label="Toutes"
              active={category === ALL}
              onClick={() => setCategory(ALL)}
            />
            {categories.map((c) => (
              <CategoryChip
                key={c}
                label={c}
                active={category === c}
                onClick={() => setCategory(c)}
              />
            ))}
          </div>
        )}
      </div>

      {/* Contenu */}
      {products.length === 0 ? (
        <EmptyState />
      ) : filtered.length === 0 ? (
        <p className="text-muted py-12 text-center text-sm">
          Aucun produit ne correspond à votre recherche.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 lg:gap-4 xl:grid-cols-5">
          {filtered.map((p) => (
            <ProductCard key={p.id} product={p} />
          ))}
        </div>
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

function ProductCard({ product }: { product: Product }) {
  const [available, setAvailable] = useState(product.is_available);
  const [pending, startTransition] = useTransition();

  function onToggle() {
    const next = !available;
    setAvailable(next); // optimiste
    startTransition(async () => {
      const res = await toggleProductAvailability(product.id, next);
      if (res?.error) setAvailable(!next); // rollback
    });
  }

  return (
    <div className="border-border bg-surface group flex flex-col overflow-hidden rounded-[16px] border shadow-sm transition-shadow hover:shadow-md">
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
              !available && "opacity-40"
            )}
          />
        ) : (
          <div className="text-subtle flex h-full w-full items-center justify-center">
            <ImageOff className="size-8" />
          </div>
        )}
        {!available && (
          <span className="bg-foreground/70 absolute top-2 left-2 rounded-full px-2 py-0.5 text-[10px] font-medium text-white">
            Indisponible
          </span>
        )}
      </Link>

      {/* Infos */}
      <div className="flex flex-1 flex-col gap-1 p-3">
        {product.category && (
          <span className="text-subtle truncate text-[10px] tracking-wide uppercase">
            {product.category}
          </span>
        )}
        <Link
          href={`/catalog/${product.id}`}
          className="line-clamp-2 text-sm leading-snug font-medium hover:underline"
        >
          {product.name_fr}
        </Link>
        <div className="text-foreground mt-auto pt-1 text-sm font-semibold">
          {formatDA(product.price_da)}
          <span className="text-subtle ml-1 text-xs font-normal">
            / {PRODUCT_UNIT_META[product.unit].short}
          </span>
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

        <Link
          href={`/catalog/${product.id}`}
          className="text-muted hover:text-primary-700 inline-flex items-center gap-1 text-xs font-medium"
        >
          <Pencil className="size-3.5" />
          Modifier
        </Link>
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
