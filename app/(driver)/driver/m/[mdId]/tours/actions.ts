"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { orderByNearest } from "@/lib/delivery/distance";

export type TourActionState = { error?: string; ok?: boolean; tourId?: string };

/**
 * Démarre une tournée pour un créneau donné : on prend toutes les commandes
 * `delivery_mode=tour` rattachées à ce slot, on calcule un ordre optimisé
 * par proximité (greedy nearest-neighbor à partir du commerçant), on crée
 * `delivery_tours` + `tour_stops`.
 */
export async function startTour(
  merchantDriverId: string,
  slotId: string
): Promise<TourActionState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expirée." };

  const { data: link } = await supabase
    .from("merchant_drivers")
    .select("id, merchant_id, driver_id, status")
    .eq("id", merchantDriverId)
    .maybeSingle();
  if (!link || link.status !== "active") return { error: "Accès refusé." };

  // Vérifie que le slot appartient au bon commerçant.
  const { data: slot } = await supabase
    .from("delivery_slots")
    .select("id, merchant_id, status")
    .eq("id", slotId)
    .maybeSingle();
  if (!slot || slot.merchant_id !== link.merchant_id) {
    return { error: "Créneau introuvable." };
  }
  if (slot.status === "cancelled") {
    return { error: "Ce créneau est annulé." };
  }

  // Commerçant (pour position de départ de l'itinéraire).
  const { data: merch } = await supabase
    .from("merchants")
    .select("latitude, longitude")
    .eq("id", link.merchant_id)
    .maybeSingle();
  if (!merch?.latitude || !merch?.longitude) {
    return { error: "Position commerçant manquante." };
  }

  // Existe déjà une tournée pour ce livreur sur ce slot ?
  const { data: existing } = await supabase
    .from("delivery_tours")
    .select("id, status")
    .eq("slot_id", slotId)
    .eq("driver_id", link.driver_id)
    .maybeSingle();
  if (existing && existing.status !== "cancelled") {
    return { ok: true, tourId: existing.id };
  }

  // Charge les commandes du slot (pas encore livrées, pas annulées).
  const { data: orders } = await supabase
    .from("orders")
    .select("id, delivery_lat, delivery_lng, status")
    .eq("delivery_slot_id", slotId)
    .eq("delivery_mode", "tour")
    .neq("status", "cancelled")
    .neq("status", "completed");
  if (!orders || orders.length === 0) {
    return { error: "Aucune commande à livrer sur ce créneau." };
  }

  // Optimise l'ordre (greedy nearest-neighbor).
  const points = orders
    .filter((o) => o.delivery_lat != null && o.delivery_lng != null)
    .map((o) => ({ id: o.id, lat: o.delivery_lat!, lng: o.delivery_lng! }));
  const ordered = orderByNearest(
    { lat: merch.latitude, lng: merch.longitude },
    points
  );

  // Insert tour + stops.
  const { data: tour, error: tourErr } = await supabase
    .from("delivery_tours")
    .insert({
      merchant_id: link.merchant_id,
      driver_id: link.driver_id,
      slot_id: slotId,
      status: "in_progress",
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (tourErr || !tour) return { error: tourErr?.message ?? "Échec tournée" };

  const stopsRows = ordered.map((p, idx) => ({
    tour_id: tour.id,
    order_id: p.id,
    stop_order: idx + 1,
  }));
  const { error: stopsErr } = await supabase
    .from("tour_stops")
    .insert(stopsRows);
  if (stopsErr) {
    await supabase.from("delivery_tours").delete().eq("id", tour.id);
    return { error: stopsErr.message };
  }

  // Attribue les commandes au driver (snapshot driver_id).
  await supabase
    .from("orders")
    .update({ delivery_driver_id: link.driver_id })
    .in(
      "id",
      ordered.map((p) => p.id)
    );

  revalidatePath(`/driver/m/${merchantDriverId}`);
  return { ok: true, tourId: tour.id };
}
