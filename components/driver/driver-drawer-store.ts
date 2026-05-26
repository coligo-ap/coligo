"use client";

import { useSyncExternalStore } from "react";

/** Mini store global pour piloter l'ouverture du drawer livreur sans context. */
let state = { open: false };
const listeners = new Set<() => void>();

function emit() {
  for (const l of listeners) l();
}

export const driverDrawer = {
  open: () => {
    if (!state.open) {
      state = { open: true };
      emit();
    }
  },
  close: () => {
    if (state.open) {
      state = { open: false };
      emit();
    }
  },
  toggle: () => {
    state = { open: !state.open };
    emit();
  },
};

export function useDriverDrawerOpen(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => state.open,
    () => false
  );
}
