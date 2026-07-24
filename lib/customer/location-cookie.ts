// =============================================================================
// Cookie MIROIR de la localisation client — contrat PARTAGÉ navigateur ⇄ serveur.
//
// Écrit côté navigateur par `writeStoredLocation` (location-store), lu côté
// SERVEUR par l'accueil pour filtrer les bannières promo AVEC la vraie position
// live dès le premier rendu (comme les grandes plateformes : la localisation
// voyage dans un cookie, le serveur renvoie déjà le bon contenu ciblé). Résultat :
// plus de bannière d'une autre ville affichée puis retirée, et plus de requête
// client redondante pour re-cibler.
//
// Module NEUTRE (ni "use client" ni "use server") : importable des deux côtés.
// Ne transporte que la position — aucune donnée sensible.
// =============================================================================

import type { BannerViewerLocation } from "@/lib/data/promo-banners";

export const LOCATION_COOKIE = "coligo_loc";

// 1 an : la position par défaut est stable ; réécrite à chaque changement réel.
export const LOCATION_COOKIE_MAX_AGE = 60 * 60 * 24 * 365;

type StoredLike = {
  latitude: number | null;
  longitude: number | null;
  wilaya_code: string | null;
  commune: string | null;
};

/** Sérialise (clés courtes) pour un cookie compact et URL-safe. */
export function encodeLocationCookie(loc: StoredLike): string {
  return encodeURIComponent(
    JSON.stringify({
      la: loc.latitude,
      lo: loc.longitude,
      w: loc.wilaya_code,
      c: loc.commune,
    })
  );
}

/** Lit le cookie côté serveur → position exploitable par `getActiveBanners`. */
export function parseLocationCookie(
  raw: string | undefined
): BannerViewerLocation | null {
  if (!raw) return null;
  try {
    const p = JSON.parse(decodeURIComponent(raw)) as {
      la?: unknown;
      lo?: unknown;
      w?: unknown;
      c?: unknown;
    };
    const lat = typeof p.la === "number" ? p.la : null;
    const lng = typeof p.lo === "number" ? p.lo : null;
    const wilaya = typeof p.w === "string" ? p.w : null;
    const commune = typeof p.c === "string" ? p.c : null;
    // Cookie vide (aucune coordonnée ni zone) → comme absent.
    if (lat == null && lng == null && !wilaya && !commune) return null;
    return { lat, lng, wilaya, commune };
  } catch {
    return null;
  }
}
