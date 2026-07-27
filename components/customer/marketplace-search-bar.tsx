"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Search, X } from "lucide-react";
import {
  useFilterParams,
  applyFilters,
} from "@/lib/customer/marketplace-filters";
import { BarcodeScanButton } from "@/components/customer/barcode-scan-button";
import { cn } from "@/lib/utils";

// =============================================================================
// MarketplaceSearchBar — barre de recherche pleine largeur (style Uber Eats),
// placée sous le header de l'accueil. Fond gris doux "Rechercher sur Coligo".
//
// Le filtrage par catégorie / mode passe désormais par les CATÉGORIES rondes et
// les PILULES (HomeFilterPills). Cette barre ne gère QUE le texte. Comme avant,
// elle communique avec la grille uniquement via l'URL param `q` (découplage).
//
// `floating` (accueil thémé, mig 0415/0416) : la pilule FLOTTE en blanc sur le
// dégradé du héro (ombre douce, texte foncé FORCÉ — socle clair, lisible aussi
// en dark mode) tant qu'elle n'est pas collée au header ; dès qu'elle se colle
// (scroll), elle reprend son fond de page normal. Détection par une sentinelle
// 1px + IntersectionObserver — aucun listener scroll coûteux.
// =============================================================================

export function MarketplaceSearchBar({
  scanEnabled = false,
  floating = false,
}: {
  /** Scan code-barres (feature flag `barcode_marketplace`, décidé serveur). */
  scanEnabled?: boolean;
  /** Accueil thémé : pilule blanche flottante sur le héro. */
  floating?: boolean;
}) {
  const params = useFilterParams();
  const t = useTranslations("home");

  const q = useMemo(() => params.get("q") ?? "", [params]);

  // Buffer local pour l'input — debounce → URL (sans round-trip serveur).
  const [qBuffer, setQBuffer] = useState(q);
  useEffect(() => setQBuffer(q), [q]);

  // Collée au header ? (mode flottant uniquement.)
  const [stuck, setStuck] = useState(false);
  const sentinelRef = useRef<HTMLDivElement | null>(null);
  useEffect(() => {
    if (!floating) return;
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      ([e]) => setStuck(!e.isIntersecting),
      // La sentinelle « disparaît » quand elle passe sous le header sticky.
      { rootMargin: "-70px 0px 0px 0px" }
    );
    io.observe(el);
    return () => io.disconnect();
  }, [floating]);

  function pushQuery(value: string) {
    applyFilters((sp) => {
      if (value) sp.set("q", value);
      else sp.delete("q");
    });
  }

  // Debounce 350 ms sur le champ texte.
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => {
    if (qBuffer === q) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => pushQuery(qBuffer), 350);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [qBuffer]);

  const onHero = floating && !stuck;

  return (
    <>
      {floating && <div ref={sentinelRef} aria-hidden className="h-px" />}
      <div
        className={cn(
          "sticky top-[57px] z-20 -mx-4 px-4 pt-1.5 pb-3 transition-colors lg:top-16 lg:-mx-6 lg:px-6",
          onHero ? "bg-transparent" : "bg-surface"
        )}
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            if (debounceRef.current) clearTimeout(debounceRef.current);
            pushQuery(qBuffer);
          }}
        >
          <div
            className={cn(
              "flex items-center gap-2.5 rounded-[14px] px-4 py-3 transition-shadow focus-within:ring-2",
              onHero
                ? // Socle CLAIR fixe (hex littéraux, immunisés contre le remap
                  // des tokens en dark) : pilule blanche lisible sur le dégradé
                  // dans LES DEUX modes.
                  "bg-[#ffffff] shadow-[0_14px_34px_-14px_rgba(0,0,0,0.45)] focus-within:ring-white/50"
                : "bg-surface-2 focus-within:ring-primary-400/40"
            )}
          >
            <Search
              className={cn(
                "size-[18px] shrink-0",
                onHero ? "text-[#1f2937]" : "text-foreground"
              )}
            />
            <input
              type="search"
              value={qBuffer}
              onChange={(e) => setQBuffer(e.target.value)}
              placeholder={t("searchPlaceholder")}
              aria-label={t("searchPlaceholder")}
              className={cn(
                "w-full bg-transparent text-[15px] font-medium outline-none",
                onHero
                  ? "text-[#111827] placeholder:text-[#6b7280]"
                  : "text-foreground placeholder:text-muted"
              )}
            />
            {qBuffer && (
              <button
                type="button"
                onClick={() => setQBuffer("")}
                className={cn(
                  "shrink-0 rounded-full p-0.5",
                  onHero
                    ? "text-[#6b7280] hover:text-[#111827]"
                    : "text-muted hover:text-foreground"
                )}
                aria-label={t("clearSearch")}
              >
                <X className="size-4" />
              </button>
            )}
            {scanEnabled && (
              <BarcodeScanButton
                surface="marketplace"
                onFound={(name) => {
                  setQBuffer(name);
                  pushQuery(name);
                }}
              />
            )}
          </div>
        </form>
      </div>
    </>
  );
}
