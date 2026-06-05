// =============================================================================
// Géocodage léger via Nominatim (OpenStreetMap) — sans clé, gratuit.
// =============================================================================
// Utilisé côté CLIENT pour :
//   - forward : « commune, wilaya, Algérie » → centre approximatif (lat/lng)
//     afin de FOCUSER la carte sur la zone choisie au moment de l'inscription /
//     édition du profil commerçant.
//   - reverse : (lat/lng) → adresse lisible, pour proposer/afficher l'adresse
//     exacte correspondant au repère placé.
//
// ⚠️ Usage modéré (un appel quand la commune change ou quand on confirme la
// position) → conforme à la politique Nominatim. Échec silencieux : si le
// service est indispo, on n'empêche jamais l'utilisateur de continuer (il place
// la position à la main).
// =============================================================================

export type LatLng = { lat: number; lng: number };

const FORWARD_CACHE = new Map<string, LatLng | null>();
const REVERSE_CACHE = new Map<string, string | null>();

/** Forward : centre approximatif d'une commune dans une wilaya algérienne. */
export async function geocodeCommune(
  communeName: string,
  wilayaName: string
): Promise<LatLng | null> {
  const q = [communeName, wilayaName, "Algérie"]
    .filter(Boolean)
    .join(", ")
    .trim();
  if (!q) return null;
  if (FORWARD_CACHE.has(q)) return FORWARD_CACHE.get(q) ?? null;

  try {
    const url =
      "https://nominatim.openstreetmap.org/search?format=jsonv2&limit=1&countrycodes=dz&accept-language=fr&q=" +
      encodeURIComponent(q);
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(String(res.status));
    const data: Array<{ lat: string; lon: string }> = await res.json();
    const hit = data[0];
    const out =
      hit && hit.lat && hit.lon
        ? { lat: Number(hit.lat), lng: Number(hit.lon) }
        : null;
    const valid =
      out && Number.isFinite(out.lat) && Number.isFinite(out.lng) ? out : null;
    FORWARD_CACHE.set(q, valid);
    return valid;
  } catch {
    FORWARD_CACHE.set(q, null);
    return null;
  }
}

/** Reverse : adresse lisible (rue, quartier, commune) pour un point donné. */
export async function reverseGeocode(
  lat: number,
  lng: number
): Promise<string | null> {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return null;
  const key = `${lat.toFixed(5)},${lng.toFixed(5)}`;
  if (REVERSE_CACHE.has(key)) return REVERSE_CACHE.get(key) ?? null;

  try {
    const url =
      "https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=18&addressdetails=1&accept-language=fr&lat=" +
      lat +
      "&lon=" +
      lng;
    const res = await fetch(url, { headers: { Accept: "application/json" } });
    if (!res.ok) throw new Error(String(res.status));
    const data: {
      display_name?: string;
      address?: Record<string, string>;
    } = await res.json();

    // Adresse courte et utile : route + n° + quartier + commune (sans le pays).
    const a = data.address ?? {};
    const parts = [
      [a.house_number, a.road].filter(Boolean).join(" "),
      a.neighbourhood || a.suburb || a.quarter,
      a.village || a.town || a.city || a.municipality,
    ].filter((s): s is string => !!s && s.trim() !== "");
    const short =
      parts.length > 0 ? parts.join(", ") : (data.display_name ?? null);
    REVERSE_CACHE.set(key, short);
    return short;
  } catch {
    REVERSE_CACHE.set(key, null);
    return null;
  }
}
