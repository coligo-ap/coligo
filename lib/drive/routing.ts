import { haversineKm } from "@/lib/delivery/distance";
import { createClient } from "@/lib/supabase/server";

// =============================================================================
// Distance/temps de trajet AUTORITAIRES (serveur). Source = OSRM (vraie route
// voiture + durée réelle). Si OSRM est indisponible, repli = ligne droite ×
// facteur de détour APPRIS par zone (drive_detour_factor, mig 0235) — jamais un
// 1,25 fixe. Sur succès OSRM, on enregistre le ratio réel route/ligne-droite
// pour affiner le facteur (best-effort).
// =============================================================================

export type LatLng = { lat: number; lng: number };

export type RoadRoute = {
  km: number;
  min: number;
  geometry?: LatLng[];
  /** true si la distance vient d'OSRM (route réelle), false si repli détour. */
  fromOsrm: boolean;
};

// Le serveur public OSRM est lent/indisponible par intermittence et SANS borne
// de temps il bloquait l'affichage du prix (distance/durée) ET le bouton
// « Proposer » plusieurs secondes. On borne donc chaque appel (timeout) et on
// pose un DISJONCTEUR : après un échec, on saute OSRM pendant OSRM_COOLDOWN_MS
// et on bascule INSTANTANÉMENT sur le repli détour → prix immédiat, jamais figé.
const OSRM_TIMEOUT_MS = 3000;
const OSRM_COOLDOWN_MS = 60_000;
let osrmDownUntil = 0;

/** Appel OSRM brut (route voiture). null si indisponible/échec (toujours borné). */
async function osrmRoute(from: LatLng, to: LatLng): Promise<RoadRoute | null> {
  // Disjoncteur : OSRM a échoué récemment → on ne retente pas (repli instantané).
  if (Date.now() < osrmDownUntil) return null;
  const r4 = (v: number) => v.toFixed(4);
  const url =
    `https://router.project-osrm.org/route/v1/driving/` +
    `${r4(from.lng)},${r4(from.lat)};${r4(to.lng)},${r4(to.lat)}` +
    `?overview=simplified&geometries=geojson&alternatives=false&steps=false`;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), OSRM_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      headers: { "User-Agent": "Coligo/0.3 (contact: dev@coligo.app)" },
      next: { revalidate: 3600 },
      signal: controller.signal,
    });
    if (!res.ok) {
      osrmDownUntil = Date.now() + OSRM_COOLDOWN_MS;
      return null;
    }
    const data = (await res.json()) as {
      code?: string;
      routes?: {
        distance?: number;
        duration?: number;
        geometry?: { coordinates?: [number, number][] };
      }[];
    };
    const route = data.code === "Ok" ? data.routes?.[0] : null;
    if (!route?.distance || !route?.duration) return null;
    const geometry = (route.geometry?.coordinates ?? [])
      .filter(
        (c) =>
          Array.isArray(c) && Number.isFinite(c[0]) && Number.isFinite(c[1])
      )
      .map(([lng, lat]) => ({ lat, lng }));
    osrmDownUntil = 0; // OSRM répond → on réarme le chemin rapide
    return {
      km: Math.max(0.1, Number((route.distance / 1000).toFixed(2))),
      // durée réelle + 20 % tampon trafic (cohérent avec l'historique).
      min: Math.max(2, Math.round((route.duration / 60) * 1.2)),
      geometry: geometry.length > 1 ? geometry : undefined,
      fromOsrm: true,
    };
  } catch {
    // Timeout (abort) ou réseau : on arme le disjoncteur → replis instantanés.
    osrmDownUntil = Date.now() + OSRM_COOLDOWN_MS;
    return null;
  } finally {
    clearTimeout(timer);
  }
}

type Rpc = (
  fn: string,
  args: Record<string, unknown>
) => Promise<{ data: unknown }>;

/**
 * Distance/temps de route AUTORITAIRES. OSRM d'abord (et on apprend le détour) ;
 * sinon ligne droite × facteur de détour appris pour la zone de départ. Toujours
 * une réponse exploitable (jamais null) → le prix n'est jamais sous-estimé par
 * une simple ligne droite.
 */
export async function roadRoute(from: LatLng, to: LatLng): Promise<RoadRoute> {
  const crow = Math.max(0.1, haversineKm(from, to));
  const osrm = await osrmRoute(from, to);

  if (osrm) {
    // Apprentissage du détour réel (best-effort, ne bloque jamais).
    try {
      const supabase = await createClient();
      const rpc = supabase.rpc.bind(supabase) as unknown as Rpc;
      await rpc("drive_detour_record", {
        p_lat: from.lat,
        p_lng: from.lng,
        p_road_km: osrm.km,
        p_crow_km: crow,
      });
    } catch {
      /* best-effort */
    }
    return osrm;
  }

  // Repli : ligne droite × facteur de détour APPRIS (sinon défaut serveur).
  let factor = 1.4;
  try {
    const supabase = await createClient();
    const rpc = supabase.rpc.bind(supabase) as unknown as Rpc;
    const { data } = await rpc("drive_detour_factor", {
      p_lat: from.lat,
      p_lng: from.lng,
    });
    const f = Number(data);
    if (Number.isFinite(f) && f >= 1.1 && f <= 2.2) factor = f;
  } catch {
    /* défaut 1.4 */
  }
  const km = Number((crow * factor).toFixed(2));
  // Durée fluide estimée (26 km/h urbain) — pas de vraie navigation dispo ici.
  const min = Math.max(2, Math.round((km / 26) * 60));
  return { km, min, fromOsrm: false };
}
