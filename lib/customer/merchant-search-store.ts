"use client";

import { useSyncExternalStore } from "react";

// =============================================================================
// Recherche produit de la fiche commerçant — état PARTAGÉ entre la barre de
// recherche du catalogue (corps de page) et la barre intégrée au header (qui
// apparaît au scroll). Ainsi le client peut chercher en TEMPS RÉEL depuis le
// header, où qu'il soit dans la page, sans remonter en haut.
// =============================================================================

type SearchState = { query: string; open: boolean };

let state: SearchState = { query: "", open: false };
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function setSearchQuery(query: string) {
  if (state.query === query) return;
  state = { ...state, query };
  emit();
}

/** Ouvre/ferme la barre de recherche intégrée au header. */
export function setSearchOpen(open: boolean) {
  if (state.open === open) return;
  state = { ...state, open };
  emit();
}

/** Réinitialise (changement de commerce / démontage). */
export function resetSearch() {
  if (state.query === "" && !state.open) return;
  state = { query: "", open: false };
  emit();
}

function subscribe(l: () => void) {
  listeners.add(l);
  return () => {
    listeners.delete(l);
  };
}

function getSnapshot() {
  return state;
}

export function useMerchantSearch(): SearchState {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}
