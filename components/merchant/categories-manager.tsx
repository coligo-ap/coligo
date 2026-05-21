"use client";

import Link from "next/link";
import Image from "next/image";
import { useState, useTransition } from "react";
import {
  ArrowLeft,
  ChevronDown,
  ChevronUp,
  FolderPlus,
  ImageOff,
  Pencil,
  Plus,
  Sparkles,
} from "lucide-react";
import { Button, buttonVariants } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { Category } from "@/lib/types";
import {
  moveCategory,
  seedCategories,
} from "@/app/(merchant)/catalog/categories/actions";

type CategoryRow = Category & { productCount: number };

export function CategoriesManager({
  categories,
  suggestions,
}: {
  categories: CategoryRow[];
  suggestions: string[];
}) {
  const [pendingId, setPendingId] = useState<string | null>(null);
  const [, startTransition] = useTransition();

  function move(id: string, direction: "up" | "down") {
    setPendingId(id);
    startTransition(async () => {
      await moveCategory(id, direction);
      setPendingId(null);
    });
  }

  // Suggestions non encore créées.
  const existing = new Set(categories.map((c) => c.title.trim().toLowerCase()));
  const freshSuggestions = suggestions.filter(
    (s) => !existing.has(s.trim().toLowerCase())
  );

  return (
    <div className="mx-auto max-w-3xl p-4 lg:p-6 lg:px-8">
      <header className="mb-5">
        <Link
          href="/catalog"
          className="text-muted hover:text-foreground mb-3 inline-flex items-center gap-1.5 text-sm"
        >
          <ArrowLeft className="size-4" />
          Retour au catalogue
        </Link>
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <h1 className="text-2xl font-bold tracking-tight lg:text-3xl">
              Catégories
            </h1>
            <p className="text-muted mt-1 text-sm">
              Organisez votre catalogue. {categories.length} catégorie
              {categories.length > 1 ? "s" : ""}.
            </p>
          </div>
          <Link href="/catalog/categories/new" className={buttonVariants()}>
            <Plus className="size-4" />
            Nouvelle catégorie
          </Link>
        </div>
      </header>

      {/* Suggestions adaptées au type de commerce */}
      {freshSuggestions.length > 0 && (
        <SuggestionsPanel suggestions={freshSuggestions} />
      )}

      {/* Liste */}
      {categories.length === 0 ? (
        <EmptyState />
      ) : (
        <ul className="space-y-2">
          {categories.map((cat, i) => (
            <li
              key={cat.id}
              className="border-border bg-surface flex items-center gap-3 rounded-[14px] border p-3"
            >
              {/* Réordonner */}
              <div className="flex flex-col">
                <button
                  type="button"
                  aria-label="Monter"
                  disabled={i === 0 || pendingId !== null}
                  onClick={() => move(cat.id, "up")}
                  className="text-muted hover:text-foreground disabled:opacity-30"
                >
                  <ChevronUp className="size-4" />
                </button>
                <button
                  type="button"
                  aria-label="Descendre"
                  disabled={i === categories.length - 1 || pendingId !== null}
                  onClick={() => move(cat.id, "down")}
                  className="text-muted hover:text-foreground disabled:opacity-30"
                >
                  <ChevronDown className="size-4" />
                </button>
              </div>

              {/* Image */}
              <div className="bg-surface-3 relative size-12 shrink-0 overflow-hidden rounded-[10px]">
                {cat.image_url ? (
                  <Image
                    src={cat.image_url}
                    alt={cat.title}
                    fill
                    sizes="48px"
                    className="object-cover"
                  />
                ) : (
                  <span className="text-subtle flex h-full items-center justify-center">
                    <ImageOff className="size-4" />
                  </span>
                )}
              </div>

              {/* Infos */}
              <div className="min-w-0 flex-1">
                <p className="truncate text-sm font-medium">{cat.title}</p>
                <p className="text-muted truncate text-xs">
                  {cat.productCount} produit{cat.productCount > 1 ? "s" : ""}
                  {cat.description ? ` · ${cat.description}` : ""}
                </p>
              </div>

              <Link
                href={`/catalog/categories/${cat.id}`}
                className="text-muted hover:text-primary-700 inline-flex items-center gap-1 text-xs font-medium"
              >
                <Pencil className="size-3.5" />
                Modifier
              </Link>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function SuggestionsPanel({ suggestions }: { suggestions: string[] }) {
  const [selected, setSelected] = useState<string[]>(suggestions);
  const [pending, startTransition] = useTransition();
  const [done, setDone] = useState(false);

  function toggle(s: string) {
    setSelected((prev) =>
      prev.includes(s) ? prev.filter((x) => x !== s) : [...prev, s]
    );
  }

  function create() {
    if (selected.length === 0) return;
    startTransition(async () => {
      await seedCategories(selected);
      setDone(true);
    });
  }

  if (done) return null;

  return (
    <div className="border-primary-200 bg-primary-50/50 mb-6 rounded-[16px] border p-4">
      <div className="mb-3 flex items-center gap-2">
        <Sparkles className="text-primary-600 size-4" />
        <h2 className="text-primary-900 text-sm font-semibold">
          Catégories suggérées pour votre activité
        </h2>
      </div>
      <div className="mb-4 flex flex-wrap gap-2">
        {suggestions.map((s) => {
          const active = selected.includes(s);
          return (
            <button
              key={s}
              type="button"
              onClick={() => toggle(s)}
              className={cn(
                "rounded-full border px-3 py-1.5 text-xs font-medium transition-colors",
                active
                  ? "border-primary-600 bg-primary-600 text-white"
                  : "border-border-strong text-muted hover:bg-surface-2 bg-white"
              )}
            >
              {s}
            </button>
          );
        })}
      </div>
      <Button
        type="button"
        size="sm"
        onClick={create}
        disabled={pending || selected.length === 0}
      >
        <FolderPlus className="size-4" />
        Créer {selected.length} catégorie{selected.length > 1 ? "s" : ""}
      </Button>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="border-border bg-surface flex flex-col items-center justify-center rounded-[16px] border border-dashed py-14 text-center">
      <div className="bg-primary-50 text-primary-600 mb-4 flex size-14 items-center justify-center rounded-2xl">
        <FolderPlus className="size-7" />
      </div>
      <h2 className="text-lg font-semibold">Aucune catégorie</h2>
      <p className="text-muted mt-1 mb-5 max-w-sm text-sm">
        Créez des catégories pour organiser vos produits et faciliter la
        navigation des clients.
      </p>
      <Link href="/catalog/categories/new" className={buttonVariants()}>
        <Plus className="size-4" />
        Créer une catégorie
      </Link>
    </div>
  );
}
