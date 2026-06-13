"use server";

import { createClient } from "@/lib/supabase/server";
import { evaluateZone, resolveWilayaCommune } from "./server";
import type { ServiceKind, ZoneEval, ZoneRole } from "./service-zones";

const ALL: ServiceKind[] = ["express", "tour", "drive"];

/**
 * Disponibilité d'un POINT pour un ou plusieurs services — appelable depuis le
 * client (formulaires d'inscription, checkout, Drive). Renvoie le verdict par
 * service. Sert la validation en TEMPS RÉEL des formulaires : on n'affiche /
 * n'autorise que ce qui est réellement couvert. Le verdict autoritaire reste
 * garanti côté DB (trigger orders + request_ride).
 */
export async function getZoneAvailability(input: {
  lat: number;
  lng: number;
  wilayaCode?: string | null;
  commune?: string | null;
  services?: ServiceKind[];
  role?: ZoneRole;
}): Promise<Partial<Record<ServiceKind, ZoneEval>>> {
  const services = input.services?.length ? input.services : ALL;
  // Résout wilaya/commune si l'appelant ne les fournit pas → les règles de
  // scope commune/wilaya sont prises en compte ici aussi (pas seulement le
  // géométrique). Sans coordonnées, on garde ce qui est fourni.
  let wilayaCode = input.wilayaCode ?? null;
  let commune = input.commune ?? null;
  if (!wilayaCode && !commune) {
    const geo = await resolveWilayaCommune(input.lat, input.lng);
    wilayaCode = geo.wilayaCode;
    commune = geo.commune;
  }
  const out: Partial<Record<ServiceKind, ZoneEval>> = {};
  await Promise.all(
    services.map(async (s) => {
      out[s] = await evaluateZone(s, input.lat, input.lng, {
        wilayaCode,
        commune,
        role: input.role ?? "any",
      });
    })
  );
  return out;
}

/**
 * Compte des prestataires EN LIGNE près d'un point (mig 0171) — pour l'UX
 * « peu de livreurs/chauffeurs disponibles » (SOFT, non-bloquant). Renvoie -1
 * en cas d'erreur infra → l'UI n'affiche alors RIEN (pas de faux négatif).
 */
export async function getProvidersOnline(input: {
  service: ServiceKind;
  lat: number;
  lng: number;
  radiusKm?: number;
}): Promise<{ count: number }> {
  try {
    const supabase = await createClient();
    const rpc = supabase.rpc.bind(supabase) as unknown as (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
    const { data, error } = await rpc("providers_online_near", {
      p_service: input.service,
      p_lat: input.lat,
      p_lng: input.lng,
      p_radius_km: input.radiusKm ?? 8,
    });
    if (error) return { count: -1 };
    return { count: typeof data === "number" ? data : 0 };
  } catch {
    return { count: -1 };
  }
}

/**
 * « Prévenez-moi quand ma zone sera couverte » (mig 0169). Best-effort :
 * n'échoue jamais l'UX. `contact` optionnel (le user_id est capté côté RPC).
 */
export async function joinZoneWaitlist(input: {
  service: ServiceKind;
  lat?: number | null;
  lng?: number | null;
  wilayaCode?: string | null;
  commune?: string | null;
  contact?: string | null;
}): Promise<{ ok: boolean }> {
  try {
    // Trace la VRAIE zone (wilaya/commune) du point : sans ça, l'admin ne voit
    // que « Point GPS (hors wilaya identifiée) » et ne peut pas regrouper la
    // demande par zone pour décider où ouvrir le service. On résout si absent.
    let wilayaCode = input.wilayaCode ?? null;
    let commune = input.commune ?? null;
    if (!wilayaCode && !commune) {
      const geo = await resolveWilayaCommune(input.lat, input.lng);
      wilayaCode = geo.wilayaCode;
      commune = geo.commune;
    }
    const supabase = await createClient();
    const rpc = supabase.rpc.bind(supabase) as unknown as (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{ error: { message: string } | null }>;
    const { error } = await rpc("join_zone_waitlist", {
      p_service: input.service,
      p_lat: input.lat ?? null,
      p_lng: input.lng ?? null,
      p_wilaya_code: wilayaCode,
      p_commune: commune,
      p_contact: input.contact ?? null,
    });
    return { ok: !error };
  } catch {
    return { ok: false };
  }
}
