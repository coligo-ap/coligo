import { NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

// =============================================================================
// Véhicules disponibles autour d'un point — LECTURE POLLÉE (carte client).
//
// ⚠️ POURQUOI UNE ROUTE ET PAS UNE SERVER ACTION : Next re-rend l'arbre SERVEUR
// de la page après CHAQUE server action. Utilisée en polling (toutes les 7 s),
// une action relançait donc le rendu de l'écran Drive, qui réécrivait son état
// de position, ce qui redéclenchait le relevé… jusqu'à « Maximum update depth
// exceeded ». Une route JSON ne touche pas au rendu : c'est l'outil correct
// pour une donnée qui se rafraîchit toute seule.
//
// Sécurité : la RPC `drive_nearby_vehicles` (mig 0400) est SECURITY DEFINER,
// réservée au rôle `authenticated`, et n'expose aucune donnée nominative
// (jeton du jour + position arrondie). On la laisse juger : ici on ne fait que
// transporter la session de l'appelant.
// =============================================================================
export async function GET(request: Request) {
  const url = new URL(request.url);
  const lat = Number(url.searchParams.get("lat"));
  const lng = Number(url.searchParams.get("lng"));
  const gamme = url.searchParams.get("gamme");
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return NextResponse.json({ vehicles: [] });
  }

  try {
    const supabase = await createClient();
    // RPC hors types générés → bind OBLIGATOIRE (cf. reference_supabase_rpc_bind).
    const rpc = supabase.rpc.bind(supabase) as unknown as (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
    const { data, error } = await rpc("drive_nearby_vehicles", {
      p_lat: lat,
      p_lng: lng,
      p_radius_km: 4,
      p_gamme: gamme || null,
      p_limit: 14,
    });
    if (error) return NextResponse.json({ vehicles: [] });
    const vehicles = ((data ?? []) as Record<string, unknown>[]).map((v) => ({
      token: String(v.token),
      lat: Number(v.lat),
      lng: Number(v.lng),
      heading: v.heading == null ? null : Number(v.heading),
      kind: v.kind === "moto" ? "moto" : "car",
      distance_km: Number(v.distance_km ?? 0),
    }));
    // Jamais de cache : une position vieille de quelques secondes ment déjà.
    return NextResponse.json(
      { vehicles },
      { headers: { "cache-control": "no-store" } }
    );
  } catch {
    return NextResponse.json({ vehicles: [] });
  }
}
