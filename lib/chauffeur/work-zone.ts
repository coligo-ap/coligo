"use client";

import { useSyncExternalStore } from "react";
import { saveChauffeurSearchRadius } from "@/app/(chauffeur)/actions";

/**
 * « Ma zone » du CHAUFFEUR (dispatch VTC). Le dispatch est TOUJOURS centré sur
 * la position GPS live du chauffeur (mig 0201) : il se déplace, son rayon le
 * suit, partout en Algérie. « Ma zone » ne choisit donc qu'un RAYON autour de
 * soi (minimum 5 km, défaut 10 km réglable par le super-admin, jusqu'à 20 km).
 * Si peu de demandes dans ce rayon, le serveur complète avec les courses les
 * plus proches au-delà (expansion auto).
 *
 * Le rayon est persisté en localStorage (réactif immédiat) ET côté serveur
 * (chauffeurs.work_zone_radius_km, source de vérité du dispatch).
 */

const KEY = "coligo_chauffeur_search_radius";

/** Rayons proposés dans le sélecteur (km). Minimum 5 km. */
export const SEARCH_RADIUS_OPTIONS = [5, 10, 15, 20] as const;
// Défaut d'AFFICHAGE au lancement (10 km). La vraie valeur par défaut appliquée
// au dispatch tant que le chauffeur n'a rien personnalisé est le réglage
// SUPER-ADMIN `drive_default_radius_km` (serveur, source de vérité).
export const DEFAULT_SEARCH_RADIUS_KM = 10;
export const MIN_SEARCH_RADIUS_KM = 5;
export const MAX_SEARCH_RADIUS_KM = 20;

let radius: number | undefined = undefined;
const listeners = new Set<() => void>();

function clamp(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULT_SEARCH_RADIUS_KM;
  return Math.min(
    MAX_SEARCH_RADIUS_KM,
    Math.max(MIN_SEARCH_RADIUS_KM, Math.round(n))
  );
}

function read(): number {
  if (typeof window === "undefined") return DEFAULT_SEARCH_RADIUS_KM;
  if (radius === undefined) {
    try {
      const raw = localStorage.getItem(KEY);
      radius = raw ? clamp(raw) : DEFAULT_SEARCH_RADIUS_KM;
    } catch {
      radius = DEFAULT_SEARCH_RADIUS_KM;
    }
  }
  return radius;
}

function emit() {
  for (const l of listeners) l();
}

export function getSearchRadius(): number {
  return read();
}

export function setSearchRadius(next: number) {
  if (typeof window === "undefined") return;
  radius = clamp(next);
  try {
    localStorage.setItem(KEY, String(radius));
  } catch {
    /* localStorage indispo → on garde l'état en mémoire */
  }
  // Persiste côté serveur pour l'enforcement DB (best-effort, non bloquant).
  void saveChauffeurSearchRadius(radius);
  emit();
}

export function useSearchRadius(): number {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => read(),
    () => DEFAULT_SEARCH_RADIUS_KM
  );
}
