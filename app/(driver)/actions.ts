"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  getCurrentDriver,
  normalizePhone,
  phoneToEmail,
} from "@/lib/auth/driver";
import { hashReferralCode } from "@/lib/drivers/referral-code";
import { isWilaya } from "@/lib/dz/wilayas";
import {
  notifyMerchantNewDriverRequest,
  notifyCustomerEnRoute,
  notifyCustomerArrived,
  notifyCustomerStatusChange,
} from "@/lib/fcm/triggers";

export type DriverAuthState = { error?: string; ok?: boolean };

const signupSchema = z.object({
  first_name: z.string().trim().min(2, "Prénom trop court").max(40),
  last_name: z.string().trim().min(2, "Nom trop court").max(40),
  phone: z.string().min(6, "Téléphone invalide"),
  email: z.string().trim().email("Email invalide").max(120),
  wilaya: z.string().refine(isWilaya, "Wilaya invalide"),
  password: z.string().min(6, "Mot de passe trop court"),
});

const loginSchema = z.object({
  phone: z.string().min(6, "Téléphone invalide"),
  password: z.string().min(1, "Mot de passe requis"),
});

const submitCodeSchema = z.object({
  code: z.string().min(4, "Code invalide").max(64),
});

// ---------------------------------------------------------------------------
// SIGNUP / LOGIN livreur
// ---------------------------------------------------------------------------
export async function driverSignup(
  _prev: DriverAuthState,
  formData: FormData
): Promise<DriverAuthState> {
  const parsed = signupSchema.safeParse({
    first_name: formData.get("first_name"),
    last_name: formData.get("last_name"),
    phone: formData.get("phone"),
    email: formData.get("email"),
    wilaya: formData.get("wilaya"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Données invalides" };
  }

  const supabase = await createClient();
  const phone = normalizePhone(parsed.data.phone);
  // L'auth livreur reste basée sur le TÉLÉPHONE (email synthétisé) ; l'email
  // réel saisi est stocké sur la table métier `drivers`.
  const authEmail = phoneToEmail(parsed.data.phone);
  const fullName = `${parsed.data.first_name} ${parsed.data.last_name}`;

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

  // Crée la ligne driver via service_role (RLS bloquerait sinon — auth est
  // valide mais pas encore confirmée et drivers a RLS strict).
  const admin = createAdminClient();
  const { error: driverErr } = await admin.from("drivers").insert({
    user_id: signup.user.id,
    full_name: fullName,
    phone,
    email: parsed.data.email,
    wilaya: parsed.data.wilaya,
  });
  if (driverErr) {
    return { error: `Profil livreur : ${driverErr.message}` };
  }

  // Redirige vers `next` si présent et sûr, sinon /driver/codes par défaut.
  const next = readSafeNext(formData.get("next"));
  redirect(next ?? "/driver/codes");
}

export async function driverLogin(
  _prev: DriverAuthState,
  formData: FormData
): Promise<DriverAuthState> {
  const parsed = loginSchema.safeParse({
    phone: formData.get("phone"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Données invalides" };
  }

  const supabase = await createClient();
  const email = phoneToEmail(parsed.data.phone);
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password: parsed.data.password,
  });
  if (error) {
    return { error: "Téléphone ou mot de passe incorrect." };
  }
  const next = readSafeNext(formData.get("next"));
  redirect(next ?? "/driver");
}

/**
 * Filtre `next` pour ne permettre QUE des chemins relatifs internes (qui
 * commencent par "/driver"). Évite un open redirect.
 */
function readSafeNext(raw: FormDataEntryValue | null): string | null {
  if (typeof raw !== "string") return null;
  const v = raw.trim();
  if (!v.startsWith("/driver")) return null;
  if (v.includes("//") || v.includes("\n")) return null;
  return v;
}

export async function driverLogout(): Promise<void> {
  const supabase = await createClient();
  await supabase.auth.signOut();
  redirect("/driver/login");
}

// ---------------------------------------------------------------------------
// Édition profil livreur (nom, téléphone)
// ---------------------------------------------------------------------------
const profileSchema = z.object({
  full_name: z.string().min(2, "Nom trop court").max(80),
  phone: z.string().min(6, "Téléphone invalide"),
});

export async function updateDriverProfile(
  _prev: DriverAuthState,
  formData: FormData
): Promise<DriverAuthState> {
  const parsed = profileSchema.safeParse({
    full_name: formData.get("full_name"),
    phone: formData.get("phone"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Données invalides" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expirée." };

  // Le téléphone est sous contrainte UNIQUE — si déjà pris, on remonte
  // l'erreur clairement.
  const phone = normalizePhone(parsed.data.phone);
  const { error } = await supabase
    .from("drivers")
    .update({
      full_name: parsed.data.full_name,
      phone,
    })
    .eq("user_id", user.id);
  if (error) {
    if (error.code === "23505") {
      return { error: "Ce téléphone est déjà associé à un autre livreur." };
    }
    return { error: error.message };
  }

  revalidatePath("/driver");
  revalidatePath("/driver/parametres");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Suppression de compte livreur (danger zone)
// ---------------------------------------------------------------------------
export async function deleteDriverAccount(): Promise<DriverAuthState> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expirée." };

  // ON DELETE CASCADE sur auth.users → drivers + merchant_drivers +
  // driver_availability + delivery_tours sont nettoyés en cascade.
  const admin = createAdminClient();
  const { error } = await admin.auth.admin.deleteUser(user.id);
  if (error) return { error: error.message };

  redirect("/driver/login");
}

// ---------------------------------------------------------------------------
// Soumission code commerçant (depuis la PWA livreur)
// ---------------------------------------------------------------------------
export async function driverSubmitCode(
  _prev: DriverAuthState,
  formData: FormData
): Promise<DriverAuthState> {
  const parsed = submitCodeSchema.safeParse({
    code: formData.get("code"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Code invalide" };
  }

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expirée." };

  // Récupère le driver row (peut être absent si signup incomplet — rare).
  const { data: driver } = await supabase
    .from("drivers")
    .select("id, full_name")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!driver) return { error: "Profil livreur introuvable." };

  const admin = createAdminClient();
  const { data: refRow } = await admin
    .from("merchant_referral_codes")
    .select("merchant_id, expires_at")
    .eq("code_hash", hashReferralCode(parsed.data.code))
    .eq("is_active", true)
    .maybeSingle();
  if (!refRow) return { error: "Code inconnu ou désactivé." };
  if (refRow.expires_at && new Date(refRow.expires_at) < new Date()) {
    return { error: "Ce code a expiré." };
  }

  const { data: existingLink } = await admin
    .from("merchant_drivers")
    .select("status")
    .eq("merchant_id", refRow.merchant_id)
    .eq("driver_id", driver.id)
    .maybeSingle();

  if (existingLink) {
    if (existingLink.status === "blocked") {
      return { error: "Le commerçant a bloqué votre accès." };
    }
    revalidatePath("/driver");
    return { ok: true };
  }

  const { error: linkErr } = await admin.from("merchant_drivers").insert({
    merchant_id: refRow.merchant_id,
    driver_id: driver.id,
    status: "pending",
  });
  if (linkErr) return { error: linkErr.message };

  await admin.from("merchant_driver_events").insert({
    merchant_id: refRow.merchant_id,
    driver_id: driver.id,
    actor_email: user.email,
    action: "request_submitted",
  });

  // Push FCM au commerçant (fire-and-forget).
  void notifyMerchantNewDriverRequest({
    merchantId: refRow.merchant_id,
    driverFullName: driver.full_name,
  });

  revalidatePath("/driver");
  return { ok: true };
}

// ---------------------------------------------------------------------------
// Statut disponibilité (Express)
// ---------------------------------------------------------------------------
export async function setAvailability(
  merchantDriverId: string,
  status: "offline" | "available"
): Promise<DriverAuthState> {
  const supabase = await createClient();
  const { error } = await supabase.rpc("set_driver_availability", {
    p_merchant_driver_id: merchantDriverId,
    p_status: status,
  });
  if (error) return { error: error.message };
  revalidatePath("/driver");
  return { ok: true };
}

/**
 * Bascule la disponibilité sur TOUS les commerçants actifs du livreur d'un
 * coup (« je passe en ligne / hors ligne »). Le statut reste stocké PAR PAIRE
 * en base (FIFO inchangé) : on boucle juste sur les paires actives.
 *
 * Les paires en pleine livraison (`busy` / `current_order_id` non nul) sont
 * ignorées : on ne coupe pas une course en cours (le RPC lèverait d'ailleurs
 * `has_pending_order`).
 */
export async function setGlobalAvailability(
  status: "offline" | "available"
): Promise<{ ok: boolean; changed: number; error?: string }> {
  const supabase = await createClient();
  const driver = await getCurrentDriver();
  if (!driver) return { ok: false, changed: 0, error: "Session expirée." };

  const { data: links } = await supabase
    .from("merchant_drivers")
    .select("id, driver_availability ( status, current_order_id )")
    .eq("driver_id", driver.id)
    .eq("status", "active");

  let changed = 0;
  for (const l of links ?? []) {
    const av = Array.isArray(l.driver_availability)
      ? l.driver_availability[0]
      : l.driver_availability;
    // On ne touche pas à une paire qui livre actuellement.
    if (av?.status === "busy" || av?.current_order_id) continue;
    const { error } = await supabase.rpc("set_driver_availability", {
      p_merchant_driver_id: l.id,
      p_status: status,
    });
    if (!error) changed += 1;
  }

  revalidatePath("/driver");
  return { ok: true, changed };
}

// ---------------------------------------------------------------------------
// Pull next express (si dispo)
// ---------------------------------------------------------------------------
export async function pullNextExpress(
  merchantDriverId: string
): Promise<{ orderId?: string; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("pull_next_express", {
    p_merchant_driver_id: merchantDriverId,
  });
  if (error) return { error: error.message };
  const row = (data as Array<{ order_id: string }> | null)?.[0];
  return row ? { orderId: row.order_id } : {};
}

// ---------------------------------------------------------------------------
// Refuser une offre Express (release + cooldown 10 min) — cf. migration 0056
// ---------------------------------------------------------------------------
export async function declineExpress(
  orderId: string
): Promise<{ ok: boolean; reason?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("release_express_order", {
    p_order_id: orderId,
  });
  if (error) return { ok: false, reason: error.message };
  const row = (
    data as Array<{ ok: boolean; reason: string | null }> | null
  )?.[0];
  if (!row) return { ok: false, reason: "no_response" };
  if (row.ok) revalidatePath("/driver");
  return { ok: row.ok, reason: row.reason ?? undefined };
}

// ---------------------------------------------------------------------------
// Récupération chez le commerçant (pickup) — 1 commande ou tournée entière
// ---------------------------------------------------------------------------
export async function markOrderPickedUp(
  orderId: string
): Promise<{ ok: boolean; reason?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("mark_delivery_picked_up", {
    p_order_id: orderId,
  });
  if (error) return { ok: false, reason: error.message };
  const row = (
    data as Array<{ ok: boolean; reason: string | null }> | null
  )?.[0];
  if (!row) return { ok: false, reason: "no_response" };
  if (row.ok) {
    revalidatePath("/driver");
    // Le client est prévenu que son livreur est en route.
    void notifyCustomerEnRoute({ orderId });
  }
  return { ok: row.ok, reason: row.reason ?? undefined };
}

// Le livreur signale son arrivée chez le client (entre « récupérée » et
// « livrée »). Le client le voit en temps réel via la colonne sur `orders`.
export async function markDeliveryArrived(
  orderId: string
): Promise<{ ok: boolean; reason?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("mark_delivery_arrived", {
    p_order_id: orderId,
  });
  if (error) return { ok: false, reason: error.message };
  const row = (
    data as Array<{ ok: boolean; reason: string | null }> | null
  )?.[0];
  if (!row) return { ok: false, reason: "no_response" };
  if (row.ok) {
    revalidatePath("/driver");
    // Le client est prévenu que son livreur est à sa porte.
    void notifyCustomerArrived({ orderId });
  }
  return { ok: row.ok, reason: row.reason ?? undefined };
}

export async function markTourPickedUp(
  tourId: string
): Promise<{ ok: boolean; count?: number; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("mark_tour_picked_up", {
    p_tour_id: tourId,
  });
  if (error) return { ok: false, error: error.message };
  const row = (data as Array<{ updated: number }> | null)?.[0];
  revalidatePath(`/driver`);
  return { ok: true, count: row?.updated ?? 0 };
}

export async function reorderTourFromPosition(
  tourId: string,
  lat: number,
  lng: number
): Promise<{ ok: boolean; reordered?: number; error?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("reorder_tour_from", {
    p_tour_id: tourId,
    p_from_lat: lat,
    p_from_lng: lng,
  });
  if (error) return { ok: false, error: error.message };
  const row = (data as Array<{ reordered: number }> | null)?.[0];
  revalidatePath(`/driver`);
  return { ok: true, reordered: row?.reordered ?? 0 };
}

// ---------------------------------------------------------------------------
// Valider une livraison (saisie code ou skip si cash)
// ---------------------------------------------------------------------------
export async function validateDelivery(input: {
  orderId: string;
  code?: string;
  skipCode?: boolean;
}): Promise<{ ok: boolean; reason?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc("validate_delivery", {
    p_order_id: input.orderId,
    p_provided_code: input.code ?? null,
    p_skip_code: input.skipCode ?? false,
    p_client_operation_id: `validate-${input.orderId}-${Date.now()}`,
  });
  if (error) return { ok: false, reason: error.message };
  const row = (
    data as Array<{ ok: boolean; reason: string | null }> | null
  )?.[0];
  if (!row) return { ok: false, reason: "no_response" };
  if (row.ok) {
    revalidatePath("/driver");
    // Livraison confirmée → on notifie le client (« Commande livrée »). La
    // completion passe par le RPC, donc notifyCustomerStatusChange n'est pas
    // appelé ailleurs pour ce cas.
    void notifyCustomerStatusChange({
      orderId: input.orderId,
      newStatus: "completed",
    });
  }
  return { ok: row.ok, reason: row.reason ?? undefined };
}

/**
 * Zones de forte demande en temps réel (carte livreur). Agrégat sans donnée
 * personnelle via le RPC `delivery_demand_zones` (mig 0093). Renvoie une liste
 * VIDE quand l'activité est normale. Tolérant aux erreurs (jamais throw).
 */
export async function getDemandZones(): Promise<
  { lat: number; lng: number; cnt: number; level: string }[]
> {
  try {
    const supabase = await createClient();
    const rpc = supabase.rpc as unknown as (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
    const { data, error } = await rpc("delivery_demand_zones", {});
    if (error || !data) return [];
    return (
      data as Array<{
        lat: number;
        lng: number;
        cnt: number;
        level: string;
      }>
    ).filter(
      (z) =>
        Number.isFinite(z.lat) &&
        Number.isFinite(z.lng) &&
        Number.isFinite(z.cnt)
    );
  } catch {
    return [];
  }
}
