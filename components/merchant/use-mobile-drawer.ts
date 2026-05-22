"use client";

import { useSyncExternalStore } from "react";

/**
 * État partagé du drawer mobile : le bouton hamburger (dans le header, en haut
 * à droite) et le panneau (rendu ailleurs) sont des composants distincts. On
 * partage l'état via un petit store module — même motif que `toast.tsx` —
 * pour éviter le prop-drilling à travers le shell (Server Component).
 */
let open = false;
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export const mobileDrawer = {
  open() {
    if (!open) {
      open = true;
      emit();
    }
  },
  close() {
    if (open) {
      open = false;
      emit();
    }
  },
};

function subscribe(cb: () => void) {
  listeners.add(cb);
  return () => {
    listeners.delete(cb);
  };
}

export function useMobileDrawerOpen(): boolean {
  return useSyncExternalStore(
    subscribe,
    () => open,
    () => false // SSR : toujours fermé au rendu serveur
  );
}
