"use client";

import { useSyncExternalStore } from "react";

/**
 * Préférence SON de l'espace livreur (sons d'alerte : mise en ligne, nouvelle
 * course, offre qui sonne, annulation). Persistée en localStorage, partagée sans
 * context — même patron que le thème ([[theme-store]]). Le défaut est ACTIVÉ : le
 * livreur ne doit pas rater une course par défaut ; il coupe explicitement s'il
 * le souhaite (la vibration reste, c'est un canal séparé).
 */
const KEY = "coligo_driver_sound";

let on: boolean | undefined; // undefined = pas encore lu
const listeners = new Set<() => void>();

function read(): boolean {
  if (typeof window === "undefined") return true; // défaut ON
  if (on === undefined) on = localStorage.getItem(KEY) !== "off";
  return on;
}
function emit() {
  for (const l of listeners) l();
}

/** Lecture synchrone (pour gater un appel `play*` hors React). */
export function isDriverSoundOn(): boolean {
  return read();
}

export function setDriverSound(next: boolean) {
  if (typeof window === "undefined") return;
  if (read() === next) return;
  on = next;
  try {
    localStorage.setItem(KEY, next ? "on" : "off");
  } catch {
    /* ignore */
  }
  emit();
}

export function toggleDriverSound() {
  setDriverSound(!read());
}

export function useDriverSound(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => read(),
    () => true
  );
}
