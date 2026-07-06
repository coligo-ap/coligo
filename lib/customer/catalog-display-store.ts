"use client";

import { useSyncExternalStore } from "react";

// =============================================================================
// Affichage du catalogue (liste / catégories) — état PARTAGÉ entre la bascule
// (affichée sur la ligne Retrait/Livraison de la fiche) et le catalogue qui
// rend les produits plus bas. Même pattern que merchant-search-store.
// =============================================================================

type DisplayMode = "list" | "categories";
type State = {
  /** null = pas encore résolu (défaut commerçant / localStorage). */
  display: DisplayMode | null;
  /** Nombre de groupes du catalogue — la bascule ne sert qu'à partir de 2. */
  groupsCount: number;
};

let state: State = { display: null, groupsCount: 0 };
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export function setCatalogDisplay(display: DisplayMode) {
  if (state.display === display) return;
  state = { ...state, display };
  emit();
}

export function setCatalogGroupsCount(groupsCount: number) {
  if (state.groupsCount === groupsCount) return;
  state = { ...state, groupsCount };
  emit();
}

/** Réinitialise (changement de commerce / démontage du catalogue). */
export function resetCatalogDisplay() {
  if (state.display === null && state.groupsCount === 0) return;
  state = { display: null, groupsCount: 0 };
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

const SERVER_SNAPSHOT: State = { display: null, groupsCount: 0 };

export function useCatalogDisplay(): State {
  return useSyncExternalStore(subscribe, getSnapshot, () => SERVER_SNAPSHOT);
}
