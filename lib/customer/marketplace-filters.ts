"use client";

import { useSyncExternalStore } from "react";

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
const SERVER_SNAPSHOT = new URLSearchParams();

function getSnapshot(): URLSearchParams {
  const search = typeof window === "undefined" ? "" : window.location.search;
  if (search !== cachedSearch) {
    cachedSearch = search;
    cachedParams = new URLSearchParams(search);
  }
  return cachedParams;
}

function getServerSnapshot(): URLSearchParams {
  return SERVER_SNAPSHOT;
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

/** Snapshot réactif des params d'URL (filtres). Remplace `useSearchParams()`. */
export function useFilterParams(): URLSearchParams {
  return useSyncExternalStore(subscribe, getSnapshot, getServerSnapshot);
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
