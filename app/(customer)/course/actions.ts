"use server";

import { createClient } from "@/lib/supabase/server";
import { notifyChauffeursNewRide } from "@/lib/fcm/triggers";

/**
 * Le client demande une course VTC (négociation). Crée la course via la RPC
 * `request_ride` puis NOTIFIE les chauffeurs proches (réseau géolocalisé).
 */
export async function requestRide(input: {
  pickup_lat: number;
  pickup_lng: number;
  pickup_text?: string | null;
  dest_lat: number;
  dest_lng: number;
  dest_text?: string | null;
  distance_km: number;
  proposed_price_da: number;
  payment_method: "cash" | "coligo_pay";
}): Promise<{ ok: boolean; rideId?: string; error?: string }> {
  const supabase = await createClient();
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message: string } | null }>;

  const { data, error } = await rpc("request_ride", {
    p_pickup_lat: input.pickup_lat,
    p_pickup_lng: input.pickup_lng,
    p_pickup_text: input.pickup_text ?? null,
    p_dest_lat: input.dest_lat,
    p_dest_lng: input.dest_lng,
    p_dest_text: input.dest_text ?? null,
    p_distance_km: input.distance_km,
    p_proposed_price: Math.max(0, Math.floor(input.proposed_price_da)),
    p_payment_method: input.payment_method,
  });
  if (error) return { ok: false, error: error.message };

  const rideId = typeof data === "string" ? data : undefined;
  if (rideId) {
    // Notif best-effort aux chauffeurs proches (ne bloque jamais la demande).
    void notifyChauffeursNewRide({ rideId });
  }
  return { ok: true, rideId };
}

/** Offres reçues sur une course (pour que le client choisisse). */
export async function getRideOffers(
  rideId: string
): Promise<
  {
    id: string;
    price_da: number;
    chauffeur_name: string;
    vehicle: string | null;
  }[]
> {
  const supabase = await createClient();
  const { data } = await supabase
    .from("ride_offers")
    .select(
      "id, price_da, status, chauffeurs ( full_name, vehicle_make, vehicle_model, vehicle_plate )"
    )
    .eq("ride_id", rideId)
    .eq("status", "offered")
    .order("price_da", { ascending: true });
  return (
    (data as unknown as
      | {
          id: string;
          price_da: number;
          chauffeurs: {
            full_name: string;
            vehicle_make: string | null;
            vehicle_model: string | null;
            vehicle_plate: string | null;
          } | null;
        }[]
      | null) ?? []
  ).map((o) => ({
    id: o.id,
    price_da: o.price_da,
    chauffeur_name: o.chauffeurs?.full_name ?? "Chauffeur",
    vehicle:
      [o.chauffeurs?.vehicle_make, o.chauffeurs?.vehicle_model]
        .filter(Boolean)
        .join(" ") ||
      o.chauffeurs?.vehicle_plate ||
      null,
  }));
}

export async function acceptOffer(
  offerId: string
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  const { data, error } = await rpc("accept_ride_offer", {
    p_offer_id: offerId,
  });
  if (error) return { ok: false, error: error.message };
  const row = (Array.isArray(data) ? data[0] : data) as {
    ok?: boolean;
    reason?: string;
  };
  return row?.ok ? { ok: true } : { ok: false, error: row?.reason };
}
