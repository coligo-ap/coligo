"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import { Search, X } from "lucide-react";

// =============================================================================
// MarketplaceSearchBar — barre de recherche pleine largeur (style Uber Eats),
// placée sous le header de l'accueil. Fond gris doux "Rechercher sur Coligo".
//
// Le filtrage par catégorie / mode passe désormais par les CATÉGORIES rondes et
// les PILULES (HomeFilterPills). Cette barre ne gère QUE le texte. Comme avant,
// elle communique avec la grille uniquement via l'URL param `q` (découplage).
// =============================================================================

export function MarketplaceSearchBar() {
  const router = useRouter();
  const params = useSearchParams();

  const q = useMemo(() => params.get("q") ?? "", [params]);

  // Buffer local pour l'input — debounce → URL.
  const [qBuffer, setQBuffer] = useState(q);
  useEffect(() => setQBuffer(q), [q]);

  function pushQuery(value: string) {
    const sp = new URLSearchParams(params.toString());
    if (value) sp.set("q", value);
    else sp.delete("q");
    const qs = sp.toString();
    router.replace(qs ? `/?${qs}` : "/", { scroll: false });
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
    <div className="bg-surface sticky top-[57px] z-20 -mx-4 px-4 pt-1.5 pb-3 lg:top-16 lg:-mx-6 lg:px-6">
      <form
        onSubmit={(e) => {
          e.preventDefault();
          if (debounceRef.current) clearTimeout(debounceRef.current);
          pushQuery(qBuffer);
        }}
      >
        <div className="bg-surface-2 focus-within:ring-primary-400/40 flex items-center gap-2.5 rounded-[12px] px-4 py-3 focus-within:ring-2">
          <Search className="text-foreground size-[18px] shrink-0" />
          <input
            type="search"
            value={qBuffer}
            onChange={(e) => setQBuffer(e.target.value)}
            placeholder="Rechercher sur Coligo"
            aria-label="Rechercher sur Coligo"
            className="placeholder:text-muted text-foreground w-full bg-transparent text-[15px] font-medium outline-none"
          />
          {qBuffer && (
            <button
              type="button"
              onClick={() => setQBuffer("")}
              className="text-muted hover:text-foreground shrink-0 rounded-full p-0.5"
              aria-label="Effacer la recherche"
            >
              <X className="size-4" />
            </button>
          )}
        </div>
      </form>
    </div>
  );
}
