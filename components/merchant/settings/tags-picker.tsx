"use client";

import { useMemo, useState } from "react";
import { Check, Plus, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  MAX_MERCHANT_TAGS,
  getTagLabel,
  normalizeTagCode,
  tagsForCategory,
} from "@/lib/config/merchant-tags";

// =============================================================================
// Multi-select des TAGS commerçant (volet 1). Pills issues de la liste proposée
// selon la catégorie ; le commerçant peut aussi en ajouter un (custom). La
// sélection est sérialisée (JSON) dans un input caché `tags` lu par updateProfile.
// =============================================================================

export function TagsPicker({
  category,
  initialTags,
  disabled,
}: {
  category: string | null;
  initialTags: string[];
  disabled?: boolean;
}) {
  const [selected, setSelected] = useState<string[]>(
    initialTags.map(normalizeTagCode).filter(Boolean)
  );
  const [custom, setCustom] = useState("");

  const suggested = useMemo(() => tagsForCategory(category), [category]);
  const suggestedCodes = useMemo(
    () => new Set(suggested.map((t) => t.code)),
    [suggested]
  );

  // Tags sélectionnés hors liste suggérée (custom / d'une autre catégorie).
  const extraSelected = selected.filter((c) => !suggestedCodes.has(c));
  const full = selected.length >= MAX_MERCHANT_TAGS;

  const toggle = (code: string) => {
    setSelected((prev) =>
      prev.includes(code)
        ? prev.filter((c) => c !== code)
        : full
          ? prev
          : [...prev, code]
    );
  };

  const addCustom = () => {
    const code = normalizeTagCode(custom);
    if (!code || full || selected.includes(code)) {
      setCustom("");
      return;
    }
    setSelected((prev) => [...prev, code]);
    setCustom("");
  };

  return (
    <div className="space-y-3">
      <input type="hidden" name="tags" value={JSON.stringify(selected)} />

      <p className="text-muted text-xs">
        Choisis les spécialités qui décrivent ton offre — elles aident les
        clients à te trouver dans la recherche. ({selected.length}/
        {MAX_MERCHANT_TAGS})
      </p>

      {suggested.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {suggested.map((tag) => {
            const on = selected.includes(tag.code);
            return (
              <button
                key={tag.code}
                type="button"
                disabled={disabled || (!on && full)}
                onClick={() => toggle(tag.code)}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-semibold transition active:scale-95 disabled:cursor-not-allowed disabled:opacity-40",
                  on
                    ? "border-primary-600 bg-primary-50 text-primary-700"
                    : "border-border-strong bg-surface text-foreground hover:border-primary-300"
                )}
              >
                {on && <Check className="size-3.5" />}
                {tag.fr}
              </button>
            );
          })}
        </div>
      ) : (
        <p className="text-subtle text-xs">
          Sélectionne d&apos;abord une catégorie pour voir les spécialités
          proposées — ou ajoute les tiennes ci-dessous.
        </p>
      )}

      {/* Tags custom déjà choisis (hors liste). */}
      {extraSelected.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {extraSelected.map((code) => (
            <span
              key={code}
              className="border-primary-600 bg-primary-50 text-primary-700 inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[13px] font-semibold"
            >
              {getTagLabel(code, "fr")}
              <button
                type="button"
                disabled={disabled}
                onClick={() => toggle(code)}
                aria-label="Retirer"
                className="hover:text-primary-900"
              >
                <X className="size-3.5" />
              </button>
            </span>
          ))}
        </div>
      )}

      {/* Ajout d'un tag custom. */}
      {!full && (
        <div className="flex gap-2">
          <input
            value={custom}
            disabled={disabled}
            onChange={(e) => setCustom(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                addCustom();
              }
            }}
            placeholder="Ajouter une spécialité…"
            maxLength={32}
            className="border-border-strong focus:ring-primary-400 focus:border-primary-400 h-9 flex-1 rounded-[10px] border bg-white px-3 text-sm focus:ring-2 focus:outline-none disabled:opacity-50"
          />
          <button
            type="button"
            disabled={disabled || custom.trim() === ""}
            onClick={addCustom}
            className="bg-foreground text-background inline-flex items-center gap-1 rounded-[10px] px-3 text-sm font-bold disabled:opacity-40"
          >
            <Plus className="size-4" />
          </button>
        </div>
      )}
    </div>
  );
}
