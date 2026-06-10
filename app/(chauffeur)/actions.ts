"use server";

import { redirect } from "next/navigation";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  normalizePhone,
  phoneToChauffeurEmail,
  getCurrentChauffeur,
} from "@/lib/auth/chauffeur";
import { isWilaya } from "@/lib/dz/wilayas";

export type ChauffeurAuthState = { error?: string; ok?: boolean };

type Rpc = (
  fn: string,
  args: Record<string, unknown>
) => Promise<{ data: unknown; error: { message: string } | null }>;

async function rpcClient() {
  const supabase = await createClient();
  return supabase.rpc.bind(supabase) as unknown as Rpc;
}

// ---------------------------------------------------------------------------
// AUTH
// ---------------------------------------------------------------------------
const signupSchema = z.object({
  full_name: z.string().trim().min(3, "Nom complet trop court").max(80),
  phone: z.string().min(6, "Téléphone invalide"),
  wilaya: z.string().refine(isWilaya, "Wilaya invalide"),
  vehicle_make: z.string().trim().max(40).optional(),
  vehicle_model: z.string().trim().max(40).optional(),
  vehicle_plate: z.string().trim().min(3, "Plaque requise").max(20),
  vehicle_color: z.string().trim().max(20).optional(),
  password: z.string().min(6, "Mot de passe trop court"),
});

export async function chauffeurSignup(
  _prev: ChauffeurAuthState,
  formData: FormData
): Promise<ChauffeurAuthState> {
  const parsed = signupSchema.safeParse({
    full_name: formData.get("full_name"),
    phone: formData.get("phone"),
    wilaya: formData.get("wilaya"),
    vehicle_make: formData.get("vehicle_make") || undefined,
    vehicle_model: formData.get("vehicle_model") || undefined,
    vehicle_plate: formData.get("vehicle_plate"),
    vehicle_color: formData.get("vehicle_color") || undefined,
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Données invalides" };
  }

  const supabase = await createClient();
  const phone = normalizePhone(parsed.data.phone);
  const authEmail = phoneToChauffeurEmail(parsed.data.phone);

  const { data: signup, error } = await supabase.auth.signUp({
    email: authEmail,
    password: parsed.data.password,
  });
  if (error || !signup.user) {
    if (error?.message.includes("registered")) {
      return { error: "Ce numéro est déjà enregistré." };
    }
    return { error: error?.message ?? "Échec inscription." };
  }

  const admin = createAdminClient();
  const { error: chErr } = await admin.from("chauffeurs").insert({
    user_id: signup.user.id,
    full_name: parsed.data.full_name,
    phone,
    wilaya: parsed.data.wilaya,
    vehicle_make: parsed.data.vehicle_make ?? null,
    vehicle_model: parsed.data.vehicle_model ?? null,
    vehicle_plate: parsed.data.vehicle_plate,
    vehicle_color: parsed.data.vehicle_color ?? null,
  });
  if (chErr) {
    if (chErr.code === "23505") {
      return { error: "Ce téléphone ou cette plaque est déjà utilisé." };
    }
    return { error: `Profil chauffeur : ${chErr.message}` };
  }

  redirect("/chauffeur");
}

const loginSchema = z.object({
  phone: z.string().min(6, "Téléphone invalide"),
  password: z.string().min(1, "Mot de passe requis"),
});

export async function chauffeurLogin(
  _prev: ChauffeurAuthState,
  formData: FormData
): Promise<ChauffeurAuthState> {
  const parsed = loginSchema.safeParse({
    phone: formData.get("phone"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Données invalides" };
  }
  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({
    email: phoneToChauffeurEmail(parsed.data.phone),
    password: parsed.data.password,
  });
  if (error) return { error: "Téléphone ou mot de passe incorrect." };
  redirect("/chauffeur");
}

export async function chauffeurLogout(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/chauffeur/login");
}

// ---------------------------------------------------------------------------
// PRÉSENCE
// ---------------------------------------------------------------------------
export async function chauffeurHeartbeat(
  lat: number,
  lng: number,
  online = true
): Promise<void> {
  try {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const rpc = await rpcClient();
    await rpc("chauffeur_heartbeat", {
      p_lat: lat,
      p_lng: lng,
      p_online: online,
    });
  } catch {
    /* best-effort */
  }
}

// ---------------------------------------------------------------------------
// COURSES (côté chauffeur)
// ---------------------------------------------------------------------------
export type NearbyRide = {
  id: string;
  pickup_text: string | null;
  dest_text: string | null;
  distance_km: number;
  proposed_price_da: number;
  suggested_price_da: number;
  payment_method: string;
  pickup_dist_km: number;
  my_offer_da: number | null;
};

export async function getNearbyRides(
  lat: number,
  lng: number
): Promise<NearbyRide[]> {
  try {
    const rpc = await rpcClient();
    const { data } = await rpc("chauffeur_nearby_rides", {
      p_lat: lat,
      p_lng: lng,
      p_radius_km: 8,
    });
    return (data as NearbyRide[] | null) ?? [];
  } catch {
    return [];
  }
}

export async function offerRide(
  rideId: string,
  price: number
): Promise<{ ok: boolean; error?: string }> {
  const rpc = await rpcClient();
  const { data, error } = await rpc("chauffeur_offer_ride", {
    p_ride_id: rideId,
    p_price: Math.max(0, Math.floor(price)),
  });
  if (error) return { ok: false, error: error.message };
  const row = (Array.isArray(data) ? data[0] : data) as {
    ok?: boolean;
    reason?: string;
  };
  return row?.ok ? { ok: true } : { ok: false, error: row?.reason };
}

/** Course active du chauffeur (accepted/arriving/arrived/in_progress). */
export async function getMyActiveRide() {
  const supabase = await createClient();
  const ch = await getCurrentChauffeur();
  if (!ch) return null;
  const { data } = await supabase
    .from("rides")
    .select(
      "id, status, pickup_text, dest_text, distance_km, agreed_price_da, payment_method, customer_id"
    )
    .eq("chauffeur_id", ch.id)
    .in("status", ["accepted", "arriving", "arrived", "in_progress"])
    .order("accepted_at", { ascending: false })
    .limit(1)
    .maybeSingle();
  return data;
}

export async function setRideStatus(
  rideId: string,
  status: "arriving" | "arrived" | "in_progress"
): Promise<{ ok: boolean; error?: string }> {
  const rpc = await rpcClient();
  const { data, error } = await rpc("ride_set_status", {
    p_ride_id: rideId,
    p_status: status,
  });
  if (error) return { ok: false, error: error.message };
  const row = (Array.isArray(data) ? data[0] : data) as {
    ok?: boolean;
    reason?: string;
  };
  return row?.ok ? { ok: true } : { ok: false, error: row?.reason };
}

export async function completeRideAction(
  rideId: string
): Promise<{ ok: boolean; error?: string }> {
  const rpc = await rpcClient();
  const { data, error } = await rpc("complete_ride", { p_ride_id: rideId });
  if (error) return { ok: false, error: error.message };
  const row = (Array.isArray(data) ? data[0] : data) as {
    ok?: boolean;
    reason?: string;
  };
  return row?.ok ? { ok: true } : { ok: false, error: row?.reason };
}

export async function cancelRideAction(
  rideId: string,
  reason?: string
): Promise<{ ok: boolean; error?: string }> {
  const rpc = await rpcClient();
  const { data, error } = await rpc("cancel_ride", {
    p_ride_id: rideId,
    p_reason: reason ?? null,
  });
  if (error) return { ok: false, error: error.message };
  const row = (Array.isArray(data) ? data[0] : data) as {
    ok?: boolean;
    reason?: string;
  };
  return row?.ok ? { ok: true } : { ok: false, error: row?.reason };
}
