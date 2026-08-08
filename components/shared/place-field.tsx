"use client";

import { useEffect, useRef, useState } from "react";
import { useLocale } from "next-intl";
import { Loader2, MapPin, Store, X } from "lucide-react";
import { geocodeSearch } from "@/app/(customer)/actions";
import { nearestWilayaCode } from "@/lib/drive/interwilaya";
import { WILAYAS } from "@/lib/config/wilayas";

/**
 * CHAMP LIEU à suggestions (covoiturage) — saisie LIBRE au niveau commune /
 * quartier / lieu-dit, alimentée par le gazetteer national (geocodeSearch :
 * geo_places + commerces + Photon, graphies tolérées). Chaque sélection
 * rattache automatiquement le lieu à sa WILAYA (plus proche chef-lieu) — c'est
 * la clé du matching par segments. Partagé client + chauffeur.
 *
 * Règles UX du repo : dropdown ancrée VERS L'INTÉRIEUR (start-0 + garde-fou de
 * largeur), résultat inline, jamais de débordement hors viewport.
 */

export type PlacePick = {
  label: string;
  secondary: string | null;
  lat: number;
  lng: number;
  /** Code wilaya déduit (référentiel 58) — sert au matching par segments. */
  wilaya: string;
};

/** Libellé wilaya localisé d'un code (repli : le code). */
export function wilayaName(code: string | null, isAr: boolean): string {
  if (!code) return "—";
  const w = WILAYAS.find((x) => x.code === code);
  return w ? (isAr ? w.name_ar : w.name) : code;
}

export function PlaceField({
  value,
  onChange,
  placeholder,
  bias,
  marker = "origin",
  autoFocus = false,
}: {
  value: PlacePick | null;
  onChange: (p: PlacePick | null) => void;
  placeholder: string;
  /** Biais de proximité du gazetteer (position connue de l'utilisateur). */
  bias?: { lat: number; lng: number } | null;
  /** Pastille de rail : rond violet (montée) ou carré encre (descente). */
  marker?: "origin" | "dest";
  autoFocus?: boolean;
}) {
  const isAr = useLocale() === "ar";
  const [query, setQuery] = useState(value?.label ?? "");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [hits, setHits] = useState<
    {
      display: string;
      secondary?: string;
      lat: number;
      lng: number;
      kind?: string;
    }[]
  >([]);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const rootRef = useRef<HTMLDivElement | null>(null);

  // La valeur externe change (préremplissage GPS, inversion…) → reflète-la.
  useEffect(() => {
    setQuery(value?.label ?? "");
  }, [value?.label]);

  // Fermeture au tap extérieur.
  useEffect(() => {
    const close = (e: PointerEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", close);
    return () => document.removeEventListener("pointerdown", close);
  }, []);

  const search = (q: string) => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    if (q.trim().length < 3) {
      setHits([]);
      setBusy(false);
      return;
    }
    setBusy(true);
    debounceRef.current = setTimeout(() => {
      void geocodeSearch({
        q,
        lat: bias?.lat,
        lng: bias?.lng,
        preferPlaces: true,
      })
        .then((res) => {
          setHits(
            ((res as { results?: typeof hits }).results ?? []).filter(
              (h) => Number.isFinite(h.lat) && Number.isFinite(h.lng)
            )
          );
        })
        .catch(() => setHits([]))
        .finally(() => setBusy(false));
    }, 300);
  };

  const pick = (h: (typeof hits)[number]) => {
    const w = nearestWilayaCode(h.lat, h.lng);
    if (!w) return;
    onChange({
      label: h.display,
      secondary: h.secondary ?? null,
      lat: h.lat,
      lng: h.lng,
      wilaya: w,
    });
    setQuery(h.display);
    setOpen(false);
  };

  return (
    <div ref={rootRef} className="relative min-w-0 flex-1">
      <div className="flex items-center gap-2.5">
        {marker === "origin" ? (
          <span
            className="size-3 shrink-0 rounded-full border-[3px]"
            style={{ borderColor: "#6C2BD9" }}
          />
        ) : (
          <span className="size-3 shrink-0 rounded-[3px] bg-[var(--d-ink)]" />
        )}
        <input
          value={query}
          autoFocus={autoFocus}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
            // Texte modifié = sélection caduque (les coords ne matchent plus).
            if (value && e.target.value !== value.label) onChange(null);
            search(e.target.value);
          }}
          onFocus={() => {
            if (hits.length > 0) setOpen(true);
          }}
          placeholder={placeholder}
          className="h-10 w-full min-w-0 bg-transparent text-[14px] font-bold outline-none placeholder:font-semibold placeholder:text-[var(--d-muted)]"
        />
        {busy ? (
          <Loader2 className="size-4 shrink-0 animate-spin text-[var(--d-muted)]" />
        ) : query ? (
          <button
            type="button"
            aria-label="✕"
            onClick={() => {
              setQuery("");
              setHits([]);
              onChange(null);
            }}
            className="grid size-6 shrink-0 place-items-center rounded-full bg-[var(--d-soft)] text-[var(--d-muted)]"
          >
            <X className="size-3.5" />
          </button>
        ) : null}
      </div>
      {/* Rattachement wilaya visible : le client comprend le matching. */}
      {value && (
        <p className="ms-[22px] mt-0.5 truncate text-[10px] font-semibold text-[var(--d-muted)]">
          {value.secondary ? `${value.secondary} · ` : ""}
          {isAr ? "ولاية" : "wilaya"} {wilayaName(value.wilaya, isAr)}
        </p>
      )}

      {open && hits.length > 0 && (
        <div className="absolute start-0 top-full z-30 mt-1 max-h-64 w-full max-w-[calc(100vw-2rem)] overflow-y-auto rounded-[10px] border border-[var(--d-line)] bg-[var(--d-surface)] shadow-[0_18px_44px_-24px_rgba(20,22,40,.55)]">
          {hits.map((h, i) => (
            <button
              key={`${h.display}-${i}`}
              type="button"
              onClick={() => pick(h)}
              className="flex w-full items-center gap-2.5 border-b border-[var(--d-line)] px-3 py-2.5 text-start last:border-b-0 active:bg-[var(--d-soft)]"
            >
              <span className="grid size-7 shrink-0 place-items-center rounded-[8px] bg-[var(--d-soft)]">
                {h.kind === "merchant" ? (
                  <Store className="size-3.5" style={{ color: "#6C2BD9" }} />
                ) : (
                  <MapPin className="size-3.5 text-[var(--d-muted)]" />
                )}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[12.5px] font-bold">
                  {h.display}
                </span>
                {h.secondary && (
                  <span className="block truncate text-[10.5px] font-medium text-[var(--d-muted)]">
                    {h.secondary}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
