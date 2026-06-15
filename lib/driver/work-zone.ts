"use client";

import { useSyncExternalStore } from "react";
import { saveDriverWorkZone } from "@/app/(driver)/actions";

/**
 * « Zone de travail » du livreur (dispatch par ZONE) — source de vérité unique,
 * persistée en localStorage et partagée dans toute l'app livreur (sans context),
 * sur le même modèle que `online-store`.
 *
 * Par défaut le livreur travaille « AUTOUR DE LUI » (zone = null) : le dispatch
 * suit sa position GPS live avec un rayon par défaut (cf. LIVE_RADIUS_KM).
 *
 * Quand il DÉFINIT une zone (un point sur la carte + un rayon), il ne reçoit
 * plus que les courses Express de cette zone, où qu'il se trouve physiquement :
 *  - `ZoneDispatch` interroge `pull_next_express_nearby` avec le CENTRE + RAYON
 *    de la zone au lieu de sa position GPS ;
 *  - le heartbeat de présence pousse aussi le centre de la zone → les push
 *    « nouvelle course » le ciblent sur sa zone (mig 0130), pas sur son GPS.
 *
 * Aucun stockage serveur : la présence (heartbeat, toutes les ~20 s) transporte
 * déjà le centre choisi côté DB — la zone reste donc locale à l'appareil.
 */

export type WorkZone = { lat: number; lng: number; radiusKm: number };

const KEY = "coligo_driver_work_zone";

/** Rayons proposés dans le sélecteur (km). */
export const ZONE_RADIUS_OPTIONS = [3, 5, 10, 15] as const;
/** Rayon par défaut d'une nouvelle zone (km). */
export const DEFAULT_ZONE_RADIUS_KM = 5;
/** Rayon utilisé en mode « autour de moi » (GPS live) — cf. RPC (défaut 6). */
export const LIVE_RADIUS_KM = 6;

// `undefined` = pas encore lu depuis localStorage ; `null` = mode « autour de moi ».
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
  return { lat, lng, radiusKm: Math.min(20, Math.max(0.5, r)) };
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
  void saveDriverWorkZone(zone);
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

/**
 * Polygone (cercle) GeoJSON autour du centre, pour matérialiser la zone sur la
 * carte MapLibre. Approximation locale (deg/km), largement suffisante à l'échelle
 * d'une ville.
 */
export function zoneCircleGeoJSON(z: WorkZone, points = 72) {
  const latR = z.radiusKm / 110.574;
  const lngR = z.radiusKm / (111.32 * Math.cos((z.lat * Math.PI) / 180));
  const ring: [number, number][] = [];
  for (let i = 0; i <= points; i++) {
    const t = (i / points) * 2 * Math.PI;
    ring.push([z.lng + lngR * Math.cos(t), z.lat + latR * Math.sin(t)]);
  }
  return {
    type: "FeatureCollection" as const,
    features: [
      {
        type: "Feature" as const,
        geometry: { type: "Polygon" as const, coordinates: [ring] },
        properties: {},
      },
    ],
  };
}
