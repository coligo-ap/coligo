"use client";

import { useEffect, useMemo, useState } from "react";
import { ChevronLeft, ChevronRight, Search } from "lucide-react";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

// =============================================================================
// Recherche + pagination CLIENT réutilisables pour les annuaires admin
// (commerçants, livreurs, chauffeurs, agents…). Filtrage par texte libre +
// découpage en pages. Évite de scroller des listes de centaines de lignes.
// =============================================================================

export function usePaginatedList<T>({
  items,
  search,
  pageSize = 20,
}: {
  items: T[];
  search: (item: T, q: string) => boolean;
  pageSize?: number;
}) {
  const [query, setQuery] = useState("");
  const [page, setPage] = useState(1);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return items;
    return items.filter((it) => search(it, q));
  }, [items, query, search]);

  const pageCount = Math.max(1, Math.ceil(filtered.length / pageSize));
  // Revenir page 1 quand la recherche change / la liste rétrécit.
  useEffect(() => {
    if (page > pageCount) setPage(1);
  }, [page, pageCount]);
  const current = Math.min(page, pageCount);
  const pageItems = filtered.slice(
    (current - 1) * pageSize,
    current * pageSize
  );

  return {
    query,
    setQuery,
    page: current,
    setPage,
    pageItems,
    total: items.length,
    filteredCount: filtered.length,
    pageCount,
    pageSize,
  };
}

export function SearchInput({
  value,
  onChange,
  placeholder = "Rechercher…",
}: {
  value: string;
  onChange: (v: string) => void;
  placeholder?: string;
}) {
  return (
    <div className="relative">
      <Search className="text-muted pointer-events-none absolute top-1/2 left-3.5 size-4 -translate-y-1/2" />
      <Input
        type="search"
        inputMode="search"
        value={value}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className="h-12 pl-10"
      />
    </div>
  );
}

export function Pager({
  page,
  pageCount,
  onPage,
  className,
}: {
  page: number;
  pageCount: number;
  onPage: (p: number) => void;
  className?: string;
}) {
  if (pageCount <= 1) return null;
  return (
    <div className={cn("flex items-center justify-center gap-2", className)}>
      <button
        type="button"
        onClick={() => onPage(page - 1)}
        disabled={page <= 1}
        className="border-border hover:bg-surface-2 rounded-control inline-flex size-9 items-center justify-center border disabled:opacity-40"
        aria-label="Page précédente"
      >
        <ChevronLeft className="size-4" />
      </button>
      <span className="text-muted px-2 text-sm tabular-nums">
        Page {page} / {pageCount}
      </span>
      <button
        type="button"
        onClick={() => onPage(page + 1)}
        disabled={page >= pageCount}
        className="border-border hover:bg-surface-2 rounded-control inline-flex size-9 items-center justify-center border disabled:opacity-40"
        aria-label="Page suivante"
      >
        <ChevronRight className="size-4" />
      </button>
    </div>
  );
}
