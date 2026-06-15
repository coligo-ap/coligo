"use client";

// =============================================================================
// Affichage d'un lieu LISIBLE (jamais de coordonnées GPS brutes).
// =============================================================================
// Côté client comme côté chauffeur, `pickup_text` / `dest_text` peuvent parfois
// être vides ou contenir des coordonnées brutes (ex. « 36.75213, 3.04197 »)
// quand le client a utilisé sa position GPS sans adresse résolue. Ce helper :
//   - détecte un texte « coordonnées » (ou vide) ;
//   - lance un reverse-geocode (caché, gratuit) pour obtenir un nom lisible ;
//   - n'affiche JAMAIS les chiffres bruts (repli « Position GPS »).
// Le cache de reverseGeocode évite les appels répétés (une seule requête par
// point, quelle que soit la carte qui l'affiche).
// =============================================================================

import { useEffect, useState } from "react";
import { reverseGeocode } from "@/app/(customer)/actions";

// Cache mémoire partagé (clé = point arrondi à ~10 m) + déduplication des
// requêtes en vol : si 10 cartes affichent le même point, une seule requête
// part. Le reverse-geocode serveur est lui-même caché 10 min (revalidate).
const NAME_CACHE = new Map<string, string | null>();
const INFLIGHT = new Map<string, Promise<string | null>>();

function ptKey(lat: number, lng: number): string {
  return `${lat.toFixed(4)},${lng.toFixed(4)}`;
}

async function resolvePlace(lat: number, lng: number): Promise<string | null> {
  const key = ptKey(lat, lng);
  if (NAME_CACHE.has(key)) return NAME_CACHE.get(key) ?? null;
  const existing = INFLIGHT.get(key);
  if (existing) return existing;
  const p = reverseGeocode({ latitude: lat, longitude: lng, precise: true })
    .then((r) => {
      const display = r.ok ? (r.display ?? null) : null;
      NAME_CACHE.set(key, display);
      INFLIGHT.delete(key);
      return display;
    })
    .catch(() => {
      INFLIGHT.delete(key);
      return null;
    });
  INFLIGHT.set(key, p);
  return p;
}

const COORDS_RE = /-?\d{1,3}[.,]\d{3,}\s*[,;]\s*-?\d{1,3}[.,]\d{3,}/;
// Libellés génériques qui ne disent RIEN au chauffeur (« Ma position »,
// « Position GPS », équivalents arabes) → à résoudre en vraie adresse.
const VAGUE_RE =
  /^(ma position|my position|position gps|point gps|موقعي|موقع gps)/i;

/**
 * Un libellé est « brut » (à remplacer par une adresse lisible) s'il est vide,
 * s'il ressemble à des coordonnées, ou s'il s'agit d'un libellé GPS générique
 * (« Ma position » côté client n'aide pas le chauffeur — on résout le point).
 */
export function isCoordsLike(text: string | null | undefined): boolean {
  if (!text || !text.trim()) return true;
  const t = text.trim();
  return COORDS_RE.test(t) || VAGUE_RE.test(t);
}

/**
 * Renvoie un nom de lieu lisible. Si `text` est déjà une adresse, on la garde ;
 * sinon on résout (lat/lng) → adresse en arrière-plan, avec repli `fallback`.
 */
export function usePlaceName(
  text: string | null | undefined,
  lat: number | null | undefined,
  lng: number | null | undefined,
  fallback = "Position GPS"
): string {
  const raw = isCoordsLike(text);
  const [resolved, setResolved] = useState<string | null>(null);

  useEffect(() => {
    if (!raw || lat == null || lng == null) {
      setResolved(null);
      return;
    }
    let alive = true;
    void resolvePlace(lat, lng).then((r) => {
      if (alive && r && !isCoordsLike(r)) setResolved(r);
    });
    return () => {
      alive = false;
    };
  }, [raw, lat, lng]);

  if (!raw) return (text as string).trim();
  return resolved ?? fallback;
}

/** Composant inline : `<Place text={...} lat={...} lng={...} />`. */
export function Place({
  text,
  lat,
  lng,
  fallback,
}: {
  text: string | null | undefined;
  lat: number | null | undefined;
  lng: number | null | undefined;
  fallback?: string;
}) {
  return <>{usePlaceName(text, lat, lng, fallback)}</>;
}
