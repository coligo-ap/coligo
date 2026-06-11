"use server";

import { createClient } from "@/lib/supabase/server";

export type ShareRide = {
  status: string;
  pickup_text: string | null;
  dest_text: string | null;
  dest_lat: number | null;
  dest_lng: number | null;
  ch_name: string | null;
  ch_vehicle: string | null;
  ch_plate: string | null;
  ch_rating: number | null;
  ch_lat: number | null;
  ch_lng: number | null;
  distance_km: number;
} | null;

/** Suivi public d'une course partagée (lien t/{token}, sans compte). */
export async function getShareRide(token: string): Promise<ShareRide> {
  const supabase = await createClient();
  const rpc = supabase.rpc.bind(supabase) as unknown as (
    fn: string,
    args: Record<string, unknown>
  ) => Promise<{ data: unknown; error: { message: string } | null }>;
  const { data } = await rpc("ride_by_share_token", { p_token: token });
  const r = (Array.isArray(data) ? data[0] : null) as Record<
    string,
    unknown
  > | null;
  if (!r) return null;
  return {
    status: r.status as string,
    pickup_text: (r.pickup_text as string) ?? null,
    dest_text: (r.dest_text as string) ?? null,
    dest_lat: (r.dest_lat as number) ?? null,
    dest_lng: (r.dest_lng as number) ?? null,
    ch_name: (r.ch_name as string) ?? null,
    ch_vehicle: (r.ch_vehicle as string) ?? null,
    ch_plate: (r.ch_plate as string) ?? null,
    ch_rating: r.ch_rating == null ? null : Number(r.ch_rating),
    ch_lat: (r.ch_lat as number) ?? null,
    ch_lng: (r.ch_lng as number) ?? null,
    distance_km: Number(r.distance_km ?? 0),
  };
}
