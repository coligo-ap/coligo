"use server";

import { createClient } from "@/lib/supabase/server";
import { fraudIngestCancel } from "@/lib/fraud/events";
import {
  notifyChauffeursNewRide,
  notifyChauffeursRideGone,
} from "@/lib/fcm/triggers";

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
export async function getRideOffers(rideId: string): Promise<
  {
    id: string;
    price_da: number;
    chauffeur_name: string;
    vehicle: string | null;
  }[]
> {
  const supabase = await createClient();
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  const { data } = await rpc("my_ride_offers", { p_ride_id: rideId });
  return (
    (data as
      | {
          id: string;
          price_da: number;
          chauffeur_name: string;
          vehicle: string | null;
          plate: string | null;
        }[]
      | null) ?? []
  ).map((o) => ({
    id: o.id,
    price_da: o.price_da,
    chauffeur_name: o.chauffeur_name ?? "Chauffeur",
    vehicle: o.vehicle ?? o.plate ?? null,
  }));
}

/** Prix suggéré (barème VTC) pour une distance — affichage côté client. */
export async function getVtcQuote(distanceKm: number): Promise<number> {
  try {
    const supabase = await createClient();
    const rpc = supabase.rpc.bind(supabase) as unknown as (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
    const { data } = await rpc("vtc_suggested_price", {
      p_distance_km: distanceKm,
    });
    return typeof data === "number" ? data : 0;
  } catch {
    return 0;
  }
}

export type CustomerActiveRide = {
  id: string;
  status: string;
  pickup_text: string | null;
  dest_text: string | null;
  distance_km: number;
  proposed_price_da: number;
  agreed_price_da: number | null;
  payment_method: string;
  chauffeur: {
    full_name: string;
    vehicle: string | null;
    plate: string | null;
    phone: string | null;
  } | null;
};

/** Course active du client (recherche / acceptée / en cours) + chauffeur. */
export async function getMyActiveRide(): Promise<CustomerActiveRide | null> {
  const supabase = await createClient();
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  const { data } = await rpc("my_active_ride", {});
  const row = (Array.isArray(data) ? data[0] : null) as {
    id: string;
    status: string;
    pickup_text: string | null;
    dest_text: string | null;
    distance_km: number;
    proposed_price_da: number;
    agreed_price_da: number | null;
    payment_method: string;
    ch_name: string | null;
    ch_vehicle: string | null;
    ch_plate: string | null;
    ch_phone: string | null;
  } | null;
  if (!row) return null;
  return {
    id: row.id,
    status: row.status,
    pickup_text: row.pickup_text,
    dest_text: row.dest_text,
    distance_km: row.distance_km,
    proposed_price_da: row.proposed_price_da,
    agreed_price_da: row.agreed_price_da,
    payment_method: row.payment_method,
    chauffeur: row.ch_name
      ? {
          full_name: row.ch_name,
          vehicle: row.ch_vehicle,
          plate: row.ch_plate,
          phone: row.ch_phone,
        }
      : null,
  };
}

export async function cancelMyRide(
  rideId: string
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  const { data, error } = await rpc("cancel_ride", {
    p_ride_id: rideId,
    p_reason: null,
  });
  if (error) return { ok: false, error: error.message };
  const row = (Array.isArray(data) ? data[0] : data) as {
    ok?: boolean;
    reason?: string;
  };
  // Anti-fraude : contexte de l'annulation (phase, position chauffeur, contact)
  if (row?.ok) void fraudIngestCancel("ride", rideId, "customer");
  return row?.ok ? { ok: true } : { ok: false, error: row?.reason };
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
    ride_id?: string;
  };
  // Course attribuée → la demande DISPARAÎT immédiatement chez les autres
  // chauffeurs (retrait temps réel, sans attendre leur poll).
  if (row?.ok && row.ride_id) {
    void notifyChauffeursRideGone({ rideId: row.ride_id });
  }
  return row?.ok ? { ok: true } : { ok: false, error: row?.reason };
}
