"use client";

import { useSyncExternalStore } from "react";

/**
 * Thème de l'espace livreur (clair par défaut + sombre), comme la bascule des
 * maquettes. Persisté en localStorage, partagé sans context. Le défaut est
 * CLAIR (cf. prompt « thème clair par défaut + sombre »).
 */
const KEY = "coligo_driver_theme";

let dark: boolean | undefined; // undefined = pas encore lu
const listeners = new Set<() => void>();

function read(): boolean {
  if (typeof window === "undefined") return false;
  if (dark === undefined) dark = localStorage.getItem(KEY) === "dark";
  return dark;
}
function emit() {
  for (const l of listeners) l();
}

export function setDriverDark(next: boolean) {
  if (typeof window === "undefined") return;
  if (read() === next) return;
  dark = next;
  try {
    localStorage.setItem(KEY, next ? "dark" : "light");
  } catch {
    /* ignore */
  }
  emit();
}

export function toggleDriverDark() {
  setDriverDark(!read());
}

export function useDriverDark(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => read(),
    () => false
  );
}
