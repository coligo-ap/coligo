"use client";

import { useMemo, useState } from "react";
import { Check, ChevronDown, Search, X } from "lucide-react";
import { useCategories } from "@/lib/hooks/use-categories";
import { cn } from "@/lib/utils";

/**
 * PHASE 2 — MULTI-SÉLECTION de catégories, CHERCHABLE (inscription +
 * réglages boutique) : un restaurant coche « pizzeria + fast-food », une
 * supérette ajoute « boulangerie »… La PREMIÈRE sélection = catégorie
 * principale (compat merchants.category). Soumission par inputs cachés :
 * `category` (principale) + `categories` (JSON). Statuts admin respectés
 * (masquées exclues, « bientôt disponible » grisées) — le serveur revalide.
 */
export function CategoryMultiSelect({
  value,
  onChange,
  disabled = false,
  currentCodes = [],
}: {
  value: string[];
  onChange: (codes: string[]) => void;
  disabled?: boolean;
  /** Codes déjà portés par le commerçant (conservables même désactivés). */
  currentCodes?: string[];
}) {
  const all = useCategories();
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState("");

  const selectable = useMemo(
    () =>
      all.filter(
        (c) =>
          // Filtres éditoriaux (kind=filter) : marketplace uniquement, jamais
          // proposés au commerçant (mapping manuel admin / auto par mots-clés).
          c.kind !== "filter" &&
          (c.status !== "hidden" || currentCodes.includes(c.code))
      ),
    [all, currentCodes]
  );
  const filtered = useMemo(() => {
    const needle = q.trim().toLowerCase();
    if (!needle) return selectable;
    return selectable.filter(
      (c) =>
        c.label.toLowerCase().includes(needle) ||
        c.labelAr.includes(needle) ||
        c.code.includes(needle)
    );
  }, [selectable, q]);

  const byCode = new Map(all.map((c) => [c.code, c]));
  const toggle = (code: string) => {
    if (disabled) return;
    onChange(
      value.includes(code) ? value.filter((v) => v !== code) : [...value, code]
    );
  };

  return (
    <div className="relative">
      {/* Valeurs soumises au serveur (validées côté serveur). */}
      <input type="hidden" name="category" value={value[0] ?? ""} />
      <input type="hidden" name="categories" value={JSON.stringify(value)} />

      {/* Déclencheur : chips des sélections + chevron. */}
      <button
        type="button"
        disabled={disabled}
        onClick={() => setOpen((v) => !v)}
        className="border-border-strong bg-surface flex min-h-11 w-full flex-wrap items-center gap-1.5 rounded-[10px] border px-3 py-2 text-left text-sm disabled:opacity-50"
      >
        {value.length === 0 ? (
          <span className="text-muted">
            — Sélectionner un ou plusieurs types —
          </span>
        ) : (
          value.map((code, i) => {
            const c = byCode.get(code);
            return (
              <span
                key={code}
                className={cn(
                  "inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-semibold",
                  i === 0
                    ? "bg-primary-600 text-white"
                    : "bg-primary-50 text-primary-700"
                )}
              >
                {c?.emoji} {c?.label ?? code}
                {i === 0 && <span className="opacity-80">· principal</span>}
                <X
                  className="size-3 cursor-pointer opacity-70"
                  onClick={(e) => {
                    e.stopPropagation();
                    toggle(code);
                  }}
                />
              </span>
            );
          })
        )}
        <ChevronDown className="text-muted ms-auto size-4 shrink-0" />
      </button>

      {open && (
        <div className="border-border bg-surface absolute z-30 mt-1 max-h-72 w-full overflow-auto rounded-[12px] border shadow-lg">
          <div className="border-border sticky top-0 border-b bg-inherit p-2">
            <div className="relative">
              <Search className="text-muted absolute top-1/2 left-2.5 size-4 -translate-y-1/2" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Chercher un type (pizza, boulangerie…)"
                className="border-border bg-surface-2 h-9 w-full rounded-[8px] border pl-8 text-sm outline-none"
              />
            </div>
          </div>
          {filtered.length === 0 && (
            <p className="text-muted p-3 text-center text-xs">
              Aucun type ne correspond.
            </p>
          )}
          {filtered.map((c) => {
            const selected = value.includes(c.code);
            const soon =
              c.status === "coming_soon" && !currentCodes.includes(c.code);
            return (
              <button
                key={c.code}
                type="button"
                disabled={soon}
                onClick={() => toggle(c.code)}
                className={cn(
                  "flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm",
                  selected && "bg-primary-50",
                  soon ? "cursor-not-allowed opacity-50" : "hover:bg-surface-2"
                )}
              >
                <span className="text-lg leading-none">{c.emoji}</span>
                <span className="min-w-0 flex-1 truncate">
                  {c.label}
                  {soon && (
                    <span className="text-muted"> — bientôt disponible</span>
                  )}
                </span>
                {selected && <Check className="text-primary-600 size-4" />}
              </button>
            );
          })}
          <div className="border-border sticky bottom-0 border-t bg-inherit p-2">
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="bg-primary-600 w-full rounded-[8px] py-2 text-xs font-bold text-white"
            >
              Terminé{value.length > 0 ? ` (${value.length})` : ""}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
