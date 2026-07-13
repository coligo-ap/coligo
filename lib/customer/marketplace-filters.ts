"use client";

import { useSyncExternalStore } from "react";
import { useSearchParams } from "next/navigation";

// =============================================================================
// Filtres marketplace (accueil) — source de vérité = l'URL, mais mise à jour
// SANS navigation RSC.
//
// PERF (« ultra fast ») : avant, chaque clic de pilule / catégorie / recherche
// appelait `router.replace("/?…")`, ce qui re-rendait TOUT le Server Component
// de l'accueil (auth + DB) à chaque clic — un aller-retour serveur inutile
// (le filtrage est fait côté client / via TanStack Query). Ici on écrit l'URL
// via `history.replaceState` (zéro navigation, zéro round-trip serveur) et on
// notifie les composants abonnés. Les filtres purement client deviennent donc
// INSTANTANÉS ; seuls catégorie/recherche déclenchent un fetch TanStack ciblé
// (avec `keepPreviousData`, sans flash), jamais un re-render serveur complet.
// =============================================================================

const listeners = new Set<() => void>();
let cachedSearch: string | null = null;
let cachedParams = new URLSearchParams();

function getSnapshot(): URLSearchParams | null {
  const search = typeof window === "undefined" ? "" : window.location.search;
  if (search !== cachedSearch) {
    cachedSearch = search;
    cachedParams = new URLSearchParams(search);
  }
  return cachedParams;
}

// Côté SERVEUR, le store externe n'a pas d'URL → `null`, et useFilterParams
// retombe sur `useSearchParams()` (les VRAIS params de la requête). ⚠️ Un
// ancien snapshot serveur VIDE rendait l'accueil NON filtré au SSR alors que
// le client rendait la recherche/catégorie (« /?q=pizza ») : deux arbres
// différents → erreurs d'hydratation React #418/#310 en prod (récupérées par
// un re-render client = HTML serveur jeté, perf gâchée) — bug vécu.
function getServerSnapshot(): URLSearchParams | null {
  return null;
}

function emit() {
  for (const l of listeners) l();
}

function subscribe(cb: () => void): () => void {
  listeners.add(cb);
  // Back/forward navigateur → l'URL change sans passer par applyFilters.
  const onPop = () => emit();
  if (listeners.size === 1 && typeof window !== "undefined") {
    window.addEventListener("popstate", onPop);
  }
  return () => {
    listeners.delete(cb);
    if (listeners.size === 0 && typeof window !== "undefined") {
      window.removeEventListener("popstate", onPop);
    }
  };
}

/**
 * Snapshot réactif des params d'URL (filtres).
 *
 * DEUX sources combinées, chacune pour ce qu'elle sait faire :
 *  - `useSearchParams()` (router) : SEULE source correcte au SSR/hydratation
 *    (params réels de la requête → le serveur rend le MÊME arbre que le
 *    client) et mise à jour lors des navigations router ;
 *  - le store externe (`history.replaceState` via applyFilters + popstate) :
 *    réactivité instantanée aux filtres purement client, que le router ne
 *    voit pas (zéro re-render RSC — c'est le but de ce module).
 * Sur le client, le store fait foi (il reflète toujours l'URL vivante) ; au
 * serveur il vaut `null` → repli sur les params du router.
 */
export function useFilterParams(): URLSearchParams {
  const routerParams = useSearchParams();
  const clientParams = useSyncExternalStore(
    subscribe,
    getSnapshot,
    getServerSnapshot
  );
  return clientParams ?? routerParams;
}

/**
 * Met à jour les filtres (mutation sur une copie des params) SANS navigation
 * RSC : on réécrit l'URL via history.replaceState puis on notifie les abonnés.
 */
export function applyFilters(mut: (sp: URLSearchParams) => void): void {
  if (typeof window === "undefined") return;
  const sp = new URLSearchParams(window.location.search);
  mut(sp);
  const qs = sp.toString();
  const url = qs
    ? `${window.location.pathname}?${qs}`
    : window.location.pathname;
  window.history.replaceState(window.history.state, "", url);
  cachedSearch = null; // force le recalcul du snapshot
  emit();
}
