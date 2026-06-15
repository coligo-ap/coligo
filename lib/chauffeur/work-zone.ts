"use client";

import { useSyncExternalStore } from "react";
import { saveChauffeurWorkZone } from "@/app/(chauffeur)/actions";

/**
 * « Zone de travail » du CHAUFFEUR (dispatch VTC par ZONE) — pendant de la zone
 * livreur (lib/driver/work-zone.ts). Persistée en localStorage ET côté serveur
 * (chauffeurs.work_zone_*, mig 0182) pour l'enforcement DB.
 *
 * Par défaut (zone = null) le chauffeur travaille « autour de lui » : le
 * dispatch suit sa position GPS live avec le rayon configurable plateforme.
 * Quand il définit une zone (point + rayon), il ne voit plus que les courses
 * dont le DÉPART est dans ce périmètre, où qu'il soit (enforcé par
 * chauffeur_nearby_rides).
 */

export type WorkZone = { lat: number; lng: number; radiusKm: number };

const KEY = "coligo_chauffeur_work_zone";

/** Rayons proposés dans le sélecteur (km) — VTC : plus larges que l'Express. */
export const ZONE_RADIUS_OPTIONS = [5, 8, 12, 20] as const;
export const DEFAULT_ZONE_RADIUS_KM = 8;
/** Rayon « autour de moi » par défaut (cf. drive_dispatch_radius_km). */
export const LIVE_RADIUS_KM = 8;

let zone: WorkZone | null | undefined = undefined;
const listeners = new Set<() => void>();

function sanitize(v: unknown): WorkZone | null {
  if (!v || typeof v !== "object") return null;
  const o = v as Record<string, unknown>;
  const lat = Number(o.lat);
  const lng = Number(o.lng);
  const r = Number(o.radiusKm);
  if (!Number.isFinite(lat) || !Number.isFinite(lng) || !Number.isFinite(r))
    return null;
  if (lat < -90 || lat > 90 || lng < -180 || lng > 180) return null;
  return { lat, lng, radiusKm: Math.min(60, Math.max(0.5, r)) };
}

function read(): WorkZone | null {
  if (typeof window === "undefined") return null;
  if (zone === undefined) {
    try {
      const raw = localStorage.getItem(KEY);
      zone = raw ? sanitize(JSON.parse(raw)) : null;
    } catch {
      zone = null;
    }
  }
  return zone;
}

function emit() {
  for (const l of listeners) l();
}

export function getWorkZone(): WorkZone | null {
  return read();
}

export function setWorkZone(next: WorkZone | null) {
  if (typeof window === "undefined") return;
  zone = next ? sanitize(next) : null;
  try {
    if (zone) localStorage.setItem(KEY, JSON.stringify(zone));
    else localStorage.removeItem(KEY);
  } catch {
    /* localStorage indispo → on garde l'état en mémoire */
  }
  // Persiste côté serveur pour l'enforcement DB (best-effort, non bloquant).
  void saveChauffeurWorkZone(zone);
  emit();
}

export function useWorkZone(): WorkZone | null {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => read(),
    () => null
  );
}
