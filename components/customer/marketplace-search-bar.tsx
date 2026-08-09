"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { Search, X } from "lucide-react";
import {
  useFilterParams,
  applyFilters,
} from "@/lib/customer/marketplace-filters";
import { BarcodeScanButton } from "@/components/customer/barcode-scan-button";
import { HomeFilterButton } from "@/components/customer/home-filter-sheet";

// =============================================================================
// MarketplaceSearchBar — barre de recherche de l'accueil, en zone NEUTRE
// (fond de page), collée sous le header. Elle ne gère QUE le texte et
// communique avec la grille via l'URL param `q` (découplage).
//
// REFONTE (allègement de la home) :
//  - plus de mode « flottant » : la pilule blanche posée sur le dégradé du héro
//    imposait 6 couleurs en dur (immunisées contre le mode sombre) et forçait
//    ~170px de violet au-dessus d'elle. Le fond de page suffit ;
//  - le bouton FILTRES vit dans cette même ligne (`HomeFilterButton`) : les 6
//    pilules qui s'empilaient sous les catégories ne sont plus une strate.
//
// L'offset sticky vient du token `--customer-header-h` (+ zone sûre du haut) :
// avant, `top-[57px]` en dur passait 5px SOUS un header de 62px.
// =============================================================================

export function MarketplaceSearchBar({
  scanEnabled = false,
  filters = true,
}: {
  /** Scan code-barres (feature flag `barcode_marketplace`, décidé serveur). */
  scanEnabled?: boolean;
  /** Bouton Filtres dans la ligne (accueil). */
  filters?: boolean;
}) {
  const params = useFilterParams();
  const t = useTranslations("home");

  const q = useMemo(() => params.get("q") ?? "", [params]);

  // Buffer local pour l'input — debounce → URL (sans round-trip serveur).
  const [qBuffer, setQBuffer] = useState(q);
  useEffect(() => setQBuffer(q), [q]);

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

  return (
    <div className="bg-surface sticky top-[calc(var(--customer-header-h)+env(safe-area-inset-top))] z-20 -mx-4 flex items-center gap-2 px-4 pt-3 pb-3 lg:top-[var(--customer-header-h-lg)] lg:-mx-6 lg:px-6">
      <form
        className="min-w-0 flex-1"
        onSubmit={(e) => {
          e.preventDefault();
          if (debounceRef.current) clearTimeout(debounceRef.current);
          pushQuery(qBuffer);
        }}
      >
        <div className="bg-surface-2 rounded-control focus-within:ring-primary-400/40 flex h-[46px] items-center gap-2.5 px-3.5 focus-within:ring-2">
          <Search className="text-muted size-[18px] shrink-0" />
          <input
            type="search"
            value={qBuffer}
            onChange={(e) => setQBuffer(e.target.value)}
            placeholder={t("searchPlaceholder")}
            aria-label={t("searchPlaceholder")}
            className="text-title-sm text-foreground placeholder:text-muted w-full bg-transparent font-medium outline-none"
          />
          {qBuffer && (
            <button
              type="button"
              onClick={() => setQBuffer("")}
              className="text-muted hover:text-foreground shrink-0 rounded-full p-0.5"
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
      {filters && <HomeFilterButton />}
    </div>
  );
}
