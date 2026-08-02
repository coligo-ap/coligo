import "server-only";
import { createAdminClient } from "@/lib/supabase/admin";

// =============================================================================
// RECHERCHE D'ADRESSE — Google d'abord, repli automatique ensuite.
//
// Ordre voulu :
//   1. GOOGLE PLACES (API « New ») — de loin la meilleure couverture des
//      commerces, quartiers et points de repère algériens ;
//   2. GAZETTEER COLIGO (table `geo_places`, ~60 k lieux DZ, PostGIS) — notre
//      base, instantanée, qui connaît les cités et lotissements que Google
//      ignore parfois ;
//   3. NOMINATIM (OpenStreetMap) — filet gratuit.
//
// La bascule est AUTOMATIQUE et RAPIDE : Google est appelé avec un délai de
// grâce court. Au-delà, on n'attend pas — une recherche d'adresse qui met trois
// secondes est une recherche abandonnée. Le repli part donc EN PARALLÈLE dès la
// première frappe utile, et on garde le meilleur résultat disponible.
//
// ⚠️ Google Places est FACTURÉ au-delà du quota gratuit. On n'appelle donc
// jamais pour moins de 3 caractères, et les résultats sont mis en cache par
// requête (mémoire du processus) — deux frappes identiques = un seul appel.
// =============================================================================

export type AddressHit = {
  label: string;
  sub: string | null;
  lat: number;
  lng: number;
  /** Qui a fourni ce résultat — utile pour comprendre et pour les tests. */
  source: "google" | "coligo" | "osm";
};

const CACHE = new Map<string, AddressHit[]>();
const CACHE_MAX = 200;
const GOOGLE_TIMEOUT_MS = 1500;

function cacheKey(q: string, near?: { lat: number; lng: number } | null) {
  const n = near ? `${near.lat.toFixed(2)},${near.lng.toFixed(2)}` : "-";
  return `${q.toLowerCase().trim()}|${n}`;
}

/** Étage 1 — Google Places (New). `null` = indisponible, on passe au repli. */
async function fromGoogle(
  q: string,
  near?: { lat: number; lng: number } | null
): Promise<AddressHit[] | null> {
  const key = process.env.GOOGLE_MAPS_API_KEY;
  if (!key) return null;
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), GOOGLE_TIMEOUT_MS);
  try {
    const res = await fetch(
      "https://places.googleapis.com/v1/places:searchText",
      {
        method: "POST",
        signal: ctrl.signal,
        headers: {
          "Content-Type": "application/json",
          "X-Goog-Api-Key": key,
          "X-Goog-FieldMask":
            "places.displayName,places.formattedAddress,places.location",
        },
        body: JSON.stringify({
          textQuery: q,
          regionCode: "DZ",
          languageCode: "fr",
          maxResultCount: 8,
          // Biais de proximité : à requête égale, ce qui est près du client
          // remonte d'abord — « boulangerie » ne doit pas renvoyer Oran à Béjaïa.
          ...(near
            ? {
                locationBias: {
                  circle: {
                    center: { latitude: near.lat, longitude: near.lng },
                    radius: 30000,
                  },
                },
              }
            : {}),
        }),
      }
    );
    if (!res.ok) return null;
    const j = (await res.json()) as {
      places?: {
        displayName?: { text?: string };
        formattedAddress?: string;
        location?: { latitude?: number; longitude?: number };
      }[];
    };
    const hits = (j.places ?? [])
      .filter(
        (p) => p.location?.latitude != null && p.location?.longitude != null
      )
      .map((p) => ({
        label: p.displayName?.text ?? p.formattedAddress ?? "",
        sub: p.formattedAddress ?? null,
        lat: p.location!.latitude!,
        lng: p.location!.longitude!,
        source: "google" as const,
      }))
      .filter((h) => h.label);
    return hits.length ? hits : null;
  } catch {
    return null; // délai dépassé, réseau, quota : on bascule sans bruit
  } finally {
    clearTimeout(t);
  }
}

/** Étage 2 — gazetteer Coligo (instantané, connaît cités et lotissements). */
async function fromColigo(
  q: string,
  near?: { lat: number; lng: number } | null
): Promise<AddressHit[]> {
  try {
    const admin = createAdminClient();
    const rpc = admin.rpc.bind(admin) as unknown as (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{ data: unknown }>;
    const { data } = await rpc("geo_search_places", {
      p_q: q,
      p_lat: near?.lat ?? null,
      p_lng: near?.lng ?? null,
      p_limit: 8,
    });
    return ((data as Record<string, unknown>[] | null) ?? [])
      .map((r) => ({
        label: String(r.name ?? ""),
        sub: (r.wilaya as string | null) ?? null,
        lat: Number(r.lat),
        lng: Number(r.lng),
        source: "coligo" as const,
      }))
      .filter((h) => h.label && Number.isFinite(h.lat));
  } catch {
    return [];
  }
}

/** Étage 3 — Nominatim (OpenStreetMap), gratuit et sans clé. */
async function fromOsm(q: string): Promise<AddressHit[]> {
  const ctrl = new AbortController();
  const t = setTimeout(() => ctrl.abort(), 2500);
  try {
    const url =
      "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=6&countrycodes=dz&accept-language=fr&q=" +
      encodeURIComponent(q);
    const res = await fetch(url, {
      signal: ctrl.signal,
      headers: { Accept: "application/json", "User-Agent": "Coligo/1.0" },
    });
    if (!res.ok) return [];
    const data = (await res.json()) as {
      lat: string;
      lon: string;
      name?: string;
      display_name?: string;
    }[];
    return data
      .map((d) => ({
        label: d.name || (d.display_name ?? "").split(",")[0] || "",
        sub: d.display_name ?? null,
        lat: Number(d.lat),
        lng: Number(d.lon),
        source: "osm" as const,
      }))
      .filter((h) => h.label && Number.isFinite(h.lat));
  } catch {
    return [];
  } finally {
    clearTimeout(t);
  }
}

/**
 * Recherche d'adresse, Google en tête et repli automatique.
 *
 * Les trois sources sont lancées ENSEMBLE : on ne fait pas attendre le client
 * que Google échoue pour commencer à chercher ailleurs. Le classement, lui,
 * reste celui voulu — Google d'abord, puis Coligo, puis OSM — et les doublons
 * (même lieu à quelques mètres) sont écartés.
 */
export async function searchAddresses(
  q: string,
  near?: { lat: number; lng: number } | null
): Promise<AddressHit[]> {
  const query = q.trim();
  if (query.length < 3) return []; // ni appel facturé ni bruit sous 3 signes

  const ck = cacheKey(query, near);
  const cached = CACHE.get(ck);
  if (cached) return cached;

  const [g, c, o] = await Promise.all([
    fromGoogle(query, near),
    fromColigo(query, near),
    fromOsm(query),
  ]);

  const out: AddressHit[] = [];
  const seen: { lat: number; lng: number }[] = [];
  const isDuplicate = (h: AddressHit) =>
    seen.some(
      (s) =>
        Math.abs(s.lat - h.lat) < 0.0004 && Math.abs(s.lng - h.lng) < 0.0004
    );

  for (const list of [g ?? [], c, o]) {
    for (const h of list) {
      if (isDuplicate(h)) continue;
      seen.push({ lat: h.lat, lng: h.lng });
      out.push(h);
      if (out.length >= 10) break;
    }
    if (out.length >= 10) break;
  }

  if (CACHE.size >= CACHE_MAX) CACHE.clear(); // cache borné, jamais de fuite
  CACHE.set(ck, out);
  return out;
}
