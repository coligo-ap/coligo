"use client";

import { useSyncExternalStore } from "react";

/**
 * Préférence SON de l'espace chauffeur (sonnerie de course entrante).
 * Persistée en localStorage, partagée sans context — même patron que le
 * thème sombre et que le sound-store livreur. Le défaut est ACTIVÉ : le
 * chauffeur ne doit pas rater une course par défaut ; il coupe explicitement
 * depuis Compte > Préférences s'il le souhaite (la vibration reste, canal
 * séparé).
 */
const KEY = "coligo_chauffeur_sound";

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

/** Lecture synchrone (pour gater une sonnerie hors React). */
export function isChauffeurSoundOn(): boolean {
  return read();
}

export function setChauffeurSound(next: boolean) {
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

export function toggleChauffeurSound() {
  setChauffeurSound(!read());
}

export function useChauffeurSound(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => read(),
    () => true
  );
}
