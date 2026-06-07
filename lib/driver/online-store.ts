"use client";

import { useSyncExternalStore } from "react";

/**
 * Intention « EN LIGNE » du livreur — source de vérité unique, persistée en
 * localStorage et partagée dans toute l'app livreur (sans context).
 *
 * Le livreur est EN LIGNE pour l'EXPRESS par défaut (plus besoin de s'inscrire
 * chez un commerçant). Tant qu'il est en ligne, le dispatch par zone tourne
 * GLOBALEMENT (monté dans le layout), quelle que soit la page livreur ouverte —
 * il reçoit donc les courses Express proches en continu, en temps réel.
 *
 * (La Tournée, elle, reste liée à une inscription chez un commerçant.)
 */
const KEY = "coligo_driver_online";

let online: boolean | null = null; // null = pas encore lu depuis localStorage
const listeners = new Set<() => void>();

function read(): boolean {
  if (typeof window === "undefined") return false;
  if (online === null) online = localStorage.getItem(KEY) === "1";
  return online;
}

function emit() {
  for (const l of listeners) l();
}

export function getDriverOnline(): boolean {
  return read();
}

export function setDriverOnline(next: boolean) {
  if (typeof window === "undefined") return;
  if (read() === next) return;
  online = next;
  try {
    localStorage.setItem(KEY, next ? "1" : "0");
  } catch {
    /* localStorage indispo → on garde l'état en mémoire */
  }
  emit();
}

export function useDriverOnline(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => read(),
    () => false
  );
}
