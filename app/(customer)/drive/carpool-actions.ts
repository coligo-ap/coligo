"use server";

import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { getFeatureFlag } from "@/lib/data/feature-flags";

// =============================================================================
// COVOITURAGE PAR PLACES — actions CLIENT (mig 0443). RPC en SESSION
// (auth.uid()) ; jamais de `.catch` sur un builder rpc (piège connu).
// =============================================================================

type Rpc = (
  fn: string,
  args: Record<string, unknown>
) => Promise<{ data: unknown; error: { message: string } | null }>;

async function rpcClient(): Promise<Rpc> {
  const supabase = await createClient();
  return supabase.rpc.bind(supabase) as unknown as Rpc;
}

export type CarpoolOffer = {
  id: string;
  from_wilaya: string;
  to_wilaya: string;
  from_text: string | null;
  to_text: string | null;
  distance_km: number;
  departure_at: string;
  seats_total: number;
  seats_left: number;
  price_per_seat_da: number;
  female_only: boolean;
  chauffeur_name: string;
  chauffeur_rating: number | null;
  gamme: string | null;
  my_booking_id: string | null;
  /** SEGMENT correspondant à la recherche (0445) : montée → descente. */
  from_seq: number;
  to_seq: number;
  seg_from_wilaya: string;
  seg_to_wilaya: string;
  seg_from_text: string | null;
  seg_to_text: string | null;
  seg_km: number;
  seg_price_da: number;
  seg_departure_at: string;
  /** Itinéraire complet ordonné — affichage « via Bouira ». */
  route_wilayas: string[];
  route_texts: string[];
};

export type CarpoolBooking = {
  id: string;
  status: string;
  seats: number;
  amount_da: number;
  payment_method: string;
  pin: string;
  refunded_da: number;
  trip_id: string;
  trip_status: string;
  from_wilaya: string;
  to_wilaya: string;
  from_text: string | null;
  to_text: string | null;
  departure_at: string;
  price_per_seat_da: number;
  chauffeur_name: string;
  /** Segment réservé (0445) + heure de montée à MON arrêt. */
  seg_from_wilaya: string | null;
  seg_to_wilaya: string | null;
  seg_from_text: string | null;
  seg_to_text: string | null;
  seg_departure_at: string | null;
};

export type CarpoolFlagLite = {
  status: "active" | "hidden" | "coming_soon" | "maintenance";
  message_fr: string | null;
  message_ar: string | null;
};

/**
 * TICK consolidé de l'écran covoiturage : départs publiés (filtres) + mes
 * réservations + état du kill-switch, en UN SEUL POST. Purge opportuniste des
 * départs périmés (fire-and-forget, service_role).
 */
export async function getCarpoolHome(filters?: {
  fromWilaya?: string | null;
  toWilaya?: string | null;
  date?: string | null; // YYYY-MM-DD (jour Alger)
}): Promise<{
  flag: CarpoolFlagLite;
  trips: CarpoolOffer[];
  bookings: CarpoolBooking[];
}> {
  const f = await getFeatureFlag("drive_carpool");
  const flag: CarpoolFlagLite = {
    status: f.status,
    message_fr: f.message_fr,
    message_ar: f.message_ar,
  };

  // Purge des départs expirés — jamais bloquante (client admin dédié).
  try {
    const admin = createAdminClient();
    const arpc = admin.rpc.bind(admin) as unknown as Rpc;
    void arpc("carpool_expire_stale", {}).then(undefined, () => undefined);
  } catch {
    /* best effort */
  }

  if (flag.status !== "active") return { flag, trips: [], bookings: [] };

  const rpc = await rpcClient();
  const { data: tripsData } = await rpc("carpool_search_trips", {
    p_from_wilaya: filters?.fromWilaya || null,
    p_to_wilaya: filters?.toWilaya || null,
    p_date: filters?.date || null,
  });
  const { data: bookingsData } = await rpc("carpool_my_bookings", {});

  const trips = ((tripsData as Record<string, unknown>[] | null) ?? []).map(
    (r) => ({
      id: r.id as string,
      from_wilaya: r.from_wilaya as string,
      to_wilaya: r.to_wilaya as string,
      from_text: (r.from_text as string) ?? null,
      to_text: (r.to_text as string) ?? null,
      distance_km: Number(r.distance_km ?? 0),
      departure_at: r.departure_at as string,
      seats_total: Number(r.seats_total ?? 0),
      seats_left: Number(r.seats_left ?? 0),
      price_per_seat_da: Number(r.price_per_seat_da ?? 0),
      female_only: Boolean(r.female_only),
      chauffeur_name: (r.chauffeur_name as string) ?? "Chauffeur",
      chauffeur_rating:
        r.chauffeur_rating == null ? null : Number(r.chauffeur_rating),
      gamme: (r.gamme as string) ?? null,
      my_booking_id: (r.my_booking_id as string) ?? null,
      from_seq: Number(r.from_seq ?? 0),
      to_seq: Number(r.to_seq ?? 1),
      seg_from_wilaya:
        (r.seg_from_wilaya as string) ?? (r.from_wilaya as string),
      seg_to_wilaya: (r.seg_to_wilaya as string) ?? (r.to_wilaya as string),
      seg_from_text: (r.seg_from_text as string) ?? null,
      seg_to_text: (r.seg_to_text as string) ?? null,
      seg_km: Number(r.seg_km ?? r.distance_km ?? 0),
      seg_price_da: Number(r.seg_price_da ?? r.price_per_seat_da ?? 0),
      seg_departure_at:
        (r.seg_departure_at as string) ?? (r.departure_at as string),
      route_wilayas: (r.route_wilayas as string[]) ?? [],
      route_texts: (r.route_texts as string[]) ?? [],
    })
  );
  const bookings = (
    (bookingsData as Record<string, unknown>[] | null) ?? []
  ).map((r) => ({
    id: r.id as string,
    status: r.status as string,
    seats: Number(r.seats ?? 0),
    amount_da: Number(r.amount_da ?? 0),
    payment_method: (r.payment_method as string) ?? "cash",
    pin: (r.pin as string) ?? "",
    refunded_da: Number(r.refunded_da ?? 0),
    trip_id: r.trip_id as string,
    trip_status: (r.trip_status as string) ?? "published",
    from_wilaya: r.from_wilaya as string,
    to_wilaya: r.to_wilaya as string,
    from_text: (r.from_text as string) ?? null,
    to_text: (r.to_text as string) ?? null,
    departure_at: r.departure_at as string,
    price_per_seat_da: Number(r.price_per_seat_da ?? 0),
    chauffeur_name: (r.chauffeur_name as string) ?? "Chauffeur",
    seg_from_wilaya: (r.seg_from_wilaya as string) ?? null,
    seg_to_wilaya: (r.seg_to_wilaya as string) ?? null,
    seg_from_text: (r.seg_from_text as string) ?? null,
    seg_to_text: (r.seg_to_text as string) ?? null,
    seg_departure_at: (r.seg_departure_at as string) ?? null,
  }));
  return { flag, trips, bookings };
}

/** Réserver ses places. Le PIN renvoyé est le billet du passager. */
export async function bookCarpoolSeats(input: {
  tripId: string;
  seats: number;
  payment: "coligo_pay" | "cash";
  operationId: string;
  routeLabel: string;
  /** Segment réservé (0445) — absent = trajet complet. */
  fromSeq?: number;
  toSeq?: number;
}): Promise<{ ok: boolean; pin?: string; error?: string }> {
  const rpc = await rpcClient();
  const { data, error } = await rpc("carpool_book_seats", {
    p_trip_id: input.tripId,
    p_seats: Math.floor(input.seats),
    p_payment: input.payment,
    p_operation_id: input.operationId,
    p_from_seq: input.fromSeq ?? null,
    p_to_seq: input.toSeq ?? null,
  });
  if (error) return { ok: false, error: error.message };
  const row = data as {
    ok?: boolean;
    reason?: string;
    pin?: string;
    already?: boolean;
  } | null;
  if (!row?.ok) return { ok: false, error: row?.reason };
  if (!row.already) {
    const { notifyCarpoolBooked } = await import("@/lib/fcm/triggers");
    void notifyCarpoolBooked({
      tripId: input.tripId,
      seats: Math.floor(input.seats),
      routeLabel: input.routeLabel,
    });
  }
  return { ok: true, pin: row.pin };
}

/** Annuler MA réservation (départ pas encore parti) — remboursée. */
export async function cancelCarpoolBooking(
  bookingId: string
): Promise<{ ok: boolean; error?: string }> {
  const rpc = await rpcClient();
  const { data, error } = await rpc("carpool_cancel_booking", {
    p_booking_id: bookingId,
  });
  if (error) return { ok: false, error: error.message };
  const row = data as { ok?: boolean; reason?: string } | null;
  return row?.ok ? { ok: true } : { ok: false, error: row?.reason };
}
