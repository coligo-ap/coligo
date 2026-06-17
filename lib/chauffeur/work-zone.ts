"use client";

import { useSyncExternalStore } from "react";
import { saveChauffeurSearchRadius } from "@/app/(chauffeur)/actions";

/**
 * « Ma zone » du CHAUFFEUR (dispatch VTC). Le dispatch est TOUJOURS centré sur
 * la position GPS live du chauffeur (mig 0201) : il se déplace, son rayon le
 * suit, partout en Algérie. « Ma zone » ne choisit donc qu'un RAYON autour de
 * soi (3 km par défaut, jusqu'à 20 km). Si peu de demandes dans ce rayon, le
 * serveur complète avec les courses les plus proches au-delà (expansion auto).
 *
 * Le rayon est persisté en localStorage (réactif immédiat) ET côté serveur
 * (chauffeurs.work_zone_radius_km, source de vérité du dispatch).
 */

const KEY = "coligo_chauffeur_search_radius";

/** Rayons proposés dans le sélecteur (km). */
export const SEARCH_RADIUS_OPTIONS = [3, 5, 10, 20] as const;
export const DEFAULT_SEARCH_RADIUS_KM = 3;
export const MAX_SEARCH_RADIUS_KM = 20;

let radius: number | undefined = undefined;
const listeners = new Set<() => void>();

function clamp(v: unknown): number {
  const n = Number(v);
  if (!Number.isFinite(n)) return DEFAULT_SEARCH_RADIUS_KM;
  return Math.min(MAX_SEARCH_RADIUS_KM, Math.max(3, Math.round(n)));
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
