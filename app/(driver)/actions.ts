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
import type { GainsEntry } from "@/components/driver/gains/gains-view";
import type { CompteData } from "@/components/driver/profile/compte-view";
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

export async function driverLogout(): Promise<{ error: string } | void> {
  const supabase = await createClient();
  const drv = await getCurrentDriver();

  // GARDE : on ne se déconnecte PAS avec une course Express en cours — le
  // livreur doit d'abord la terminer (il en est responsable jusqu'à livraison).
  // Vérif côté serveur (source de vérité) : commande qui lui est attribuée,
  // mode express, pas encore livrée ni terminée/annulée.
  if (drv) {
    const admin = createAdminClient();
    const { count } = await admin
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("delivery_driver_id", drv.id)
      .eq("delivery_mode", "express")
      .is("delivery_delivered_at", null)
      .not("status", "in", "(completed,cancelled)");
    if ((count ?? 0) > 0) {
      return {
        error: "Terminez votre course en cours avant de vous déconnecter.",
      };
    }
  }

  // Se déconnecter ⇒ passer HORS LIGNE automatiquement. La présence livreur =
  // dernier heartbeat (driver_presence) ; on supprime la ligne pour qu'il ne
  // soit plus « présent » pour le dispatch Express dès la déconnexion (AVANT
  // signOut, tant que la session vaut encore).
  try {
    if (drv) {
      const admin = createAdminClient();
      // driver_presence absente de database.types.ts généré (Docker requis) →
      // cast localisé du from().
      const from = admin.from.bind(admin) as unknown as (t: string) => {
        delete: () => { eq: (c: string, v: string) => PromiseLike<unknown> };
      };
      await from("driver_presence").delete().eq("driver_id", drv.id);
    }
  } catch {
    /* best-effort — ne jamais empêcher la déconnexion */
  }
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
  // ANTI-FRAUDE : un livreur ne peut PLUS supprimer lui-même son compte (il
  // pourrait disparaître à tout moment, ex. après un litige/vol). La suppression
  // définitive passe désormais EXCLUSIVEMENT par l'équipe super-admin. On refuse
  // donc toute auto-suppression, même si l'action est appelée directement.
  return {
    error:
      "La suppression d'un compte livreur passe par l'équipe Coligo. Contacte le support.",
  };
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
  // Livreur gelé : ne peut PAS passer en ligne (le retour hors ligne reste ok).
  if (driver.is_frozen && status !== "offline") {
    return { ok: false, changed: 0, error: "FROZEN" };
  }

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

// ---------------------------------------------------------------------------
// No-show ESPÈCES (mig 0327) : la commande est ANNULÉE. Le livreur n'est PAS
// payé pour la course ; en EXPRESS il ne récupère que l'avance (P − commission)
// via le support, et la pénalité (D) est prélevée sur le wallet client. En
// TOURNÉE la plateforme reste neutre (tout à la charge du commerçant).
// Une commande PRÉPAYÉE EN LIGNE renvoie 'use_leave_at_door' → utiliser
// `leaveAtDoor` (dépôt + photo) à la place.
// ---------------------------------------------------------------------------
export async function reportNoShow(input: {
  orderId: string;
  reason?: "no_show" | "refused";
}): Promise<{ ok: boolean; reason?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "driver_report_no_show" as never,
    {
      p_order_id: input.orderId,
      p_reason: input.reason ?? "no_show",
      p_client_operation_id: `noshow-${input.orderId}-${Date.now()}`,
    } as never
  );
  if (error) return { ok: false, reason: error.message };
  const row = (
    data as Array<{ ok: boolean; reason: string | null }> | null
  )?.[0];
  if (!row) return { ok: false, reason: "no_response" };
  if (row.ok) {
    revalidatePath("/driver");
    void notifyCustomerStatusChange({
      orderId: input.orderId,
      newStatus: "cancelled",
    });
  }
  return { ok: row.ok, reason: row.reason ?? undefined };
}

// ---------------------------------------------------------------------------
// No-show ONLINE façon UberEats — 3 étapes anti-fraude (mig 0328).
// ---------------------------------------------------------------------------

/** 1) Le livreur a tenté d'appeler le client (précondition du dépôt). */
export async function noteCallAttempt(
  orderId: string
): Promise<{ ok: boolean; reason?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "driver_note_call_attempt" as never,
    { p_order_id: orderId } as never
  );
  if (error) return { ok: false, reason: error.message };
  const row = (
    data as unknown as Array<{ ok: boolean; reason: string | null }> | null
  )?.[0];
  return { ok: row?.ok ?? false, reason: row?.reason ?? undefined };
}

/**
 * 2) Arrivée GÉO-CLÔTURÉE : démarre le minuteur no-show. Exige d'être à
 * quelques mètres de l'adresse exacte + appel tenté + message d'arrivée envoyé.
 * Notifie le client (« votre livreur est arrivé »).
 */
export async function confirmArrival(input: {
  orderId: string;
  lat: number;
  lng: number;
}): Promise<{ ok: boolean; reason?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "driver_confirm_arrival" as never,
    {
      p_order_id: input.orderId,
      p_lat: input.lat,
      p_lng: input.lng,
    } as never
  );
  if (error) return { ok: false, reason: error.message };
  const row = (
    data as unknown as Array<{ ok: boolean; reason: string | null }> | null
  )?.[0];
  if (row?.ok) {
    revalidatePath("/driver");
    void notifyCustomerArrived({ orderId: input.orderId });
  }
  return { ok: row?.ok ?? false, reason: row?.reason ?? undefined };
}

/**
 * 3) Dépôt à l'adresse (ONLINE prépayé, après minuteur) : commande livrée
 * « No-Show » avec photo de preuve + commentaire. Le client est payé/traité
 * comme une livraison normale (il a déjà tout réglé) et garde son cashback.
 */
export async function leaveAtDoor(input: {
  orderId: string;
  photoUrl: string;
  note?: string;
}): Promise<{ ok: boolean; reason?: string }> {
  const supabase = await createClient();
  const { data, error } = await supabase.rpc(
    "driver_leave_at_door" as never,
    {
      p_order_id: input.orderId,
      p_photo_url: input.photoUrl,
      p_note: input.note ?? null,
      p_client_operation_id: `leave-${input.orderId}-${Date.now()}`,
    } as never
  );
  if (error) return { ok: false, reason: error.message };
  const row = (
    data as unknown as Array<{ ok: boolean; reason: string | null }> | null
  )?.[0];
  if (row?.ok) {
    revalidatePath("/driver");
    void notifyCustomerStatusChange({
      orderId: input.orderId,
      newStatus: "completed",
    });
  }
  return { ok: row?.ok ?? false, reason: row?.reason ?? undefined };
}

/**
 * Heartbeat de présence : le livreur EN LIGNE pousse sa position (toutes les
 * ~20 s, depuis ZoneDispatch). Sert à notifier le RÉSEAU GLOBAL géolocalisé
 * quand une course express apparaît (mig 0130). Tolérant aux erreurs (no-op).
 */
export async function driverHeartbeat(lat: number, lng: number): Promise<void> {
  try {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const supabase = await createClient();
    const rpc = supabase.rpc.bind(supabase) as unknown as (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{ error: { message: string } | null }>;
    await rpc("driver_heartbeat", { p_lat: lat, p_lng: lng });
  } catch {
    /* no-op : la présence est best-effort */
  }
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
    const rpc = supabase.rpc.bind(supabase) as unknown as (
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

// =============================================================================
// Notation + signalement du CLIENT par le livreur (après livraison).
// =============================================================================

/** Le livreur note le client (1..5 + commentaire). Insertion directe (RLS +
 *  trigger valident : commande livrée + attribuée au livreur). Idempotent. */
export async function rateCustomer(input: {
  orderId: string;
  rating: number;
  comment?: string | null;
}): Promise<{ ok: boolean; reason?: string }> {
  try {
    const driver = await getCurrentDriver();
    if (!driver) return { ok: false, reason: "not_a_driver" };
    if (
      !Number.isInteger(input.rating) ||
      input.rating < 1 ||
      input.rating > 5
    ) {
      return { ok: false, reason: "bad_rating" };
    }
    const comment = (input.comment ?? "").trim().slice(0, 500) || null;

    const supabase = await createClient();
    const { data: order } = await supabase
      .from("orders")
      .select("id, customer_id, delivery_driver_id, status")
      .eq("id", input.orderId)
      .maybeSingle();
    if (!order) return { ok: false, reason: "order_not_found" };
    if (order.delivery_driver_id !== driver.id)
      return { ok: false, reason: "not_attributed" };
    if (order.status !== "completed")
      return { ok: false, reason: "not_completed" };
    if (!order.customer_id) return { ok: false, reason: "no_customer" };

    const table = supabase.from("customer_ratings" as never) as unknown as {
      insert: (v: Record<string, unknown>) => Promise<{
        error: { code?: string; message: string } | null;
      }>;
    };
    const { error } = await table.insert({
      order_id: order.id,
      driver_id: driver.id,
      customer_id: order.customer_id,
      rating: input.rating,
      comment,
    });
    if (error) {
      if (error.code === "23505") return { ok: false, reason: "already_rated" };
      return { ok: false, reason: error.message };
    }
    revalidatePath("/driver");
    return { ok: true };
  } catch {
    return { ok: false, reason: "error" };
  }
}

/** Le livreur signale un problème avec le client. RPC SECURITY DEFINER (rôle
 *  livreur déterminé serveur). */
export async function reportCustomer(input: {
  orderId: string;
  reason: string;
  details?: string | null;
}): Promise<{ ok: boolean; reason?: string }> {
  try {
    const supabase = await createClient();
    const reason = (input.reason ?? "").trim().slice(0, 60);
    if (!reason) return { ok: false, reason: "bad_reason" };
    const details = (input.details ?? "").trim().slice(0, 1000) || null;
    const rpc = supabase.rpc.bind(supabase) as unknown as (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
    const { data, error } = await rpc("submit_delivery_report", {
      p_order_id: input.orderId,
      p_reason: reason,
      p_details: details,
    });
    if (error) return { ok: false, reason: error.message };
    const row = (Array.isArray(data) ? data[0] : data) as
      | { ok?: boolean; reason?: string | null }
      | undefined;
    if (!row?.ok) return { ok: false, reason: row?.reason ?? "error" };
    return { ok: true };
  } catch {
    return { ok: false, reason: "error" };
  }
}

/**
 * Dispatch par ZONE : tente d'attribuer au livreur la commande express du
 * commerçant le PLUS PROCHE (RPC pull_next_express_nearby, mig 0100). Renvoie
 * uniquement l'orderId → le livreur est routé vers /driver/course/[orderId]
 * (course autonome, SANS inscription chez le commerçant). No-op si rien à
 * proximité ou si le livreur a déjà une course. Jamais throw.
 */
export async function pullNextExpressNearby(
  lat: number,
  lng: number,
  radiusKm = 6
): Promise<{ orderId?: string }> {
  try {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return {};
    const supabase = await createClient();
    const rpc = supabase.rpc.bind(supabase) as unknown as (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
    const { data, error } = await rpc("pull_next_express_nearby", {
      p_lat: lat,
      p_lng: lng,
      p_radius_km: radiusKm,
    });
    if (error || !data) return {};
    const row = (Array.isArray(data) ? data[0] : data) as
      | { res_order_id?: string }
      | undefined;
    if (!row?.res_order_id) return {};
    return { orderId: row.res_order_id };
  } catch {
    return {};
  }
}

/**
 * Persiste la ZONE DE TRAVAIL du livreur côté serveur (mig 0182) — ainsi
 * l'enforcement est garanti en base : le livreur ne reçoit que les commandes
 * de sa zone, où qu'il se trouve. `null` → retire la zone (repli rayon live).
 * Best-effort : ne bloque jamais l'UI.
 */
export async function saveDriverWorkZone(
  zone: { lat: number; lng: number; radiusKm: number } | null
): Promise<void> {
  try {
    const supabase = await createClient();
    const rpc = supabase.rpc.bind(supabase) as unknown as (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{ data: unknown; error: unknown }>;
    await rpc("set_driver_work_zone", {
      p_lat: zone?.lat ?? null,
      p_lng: zone?.lng ?? null,
      p_radius_km: zone?.radiusKm ?? null,
    });
  } catch {
    /* best effort — la zone locale reste la source pour l'UI */
  }
}

// =============================================================================
// SELF-SERVICE LIVREUR — véhicule / pièces / versements (mig 0110)
// =============================================================================
// PREMIÈRE FOIS (compte NON vérifié) : le livreur renseigne lui-même ses infos
// dans les MÊMES tables que le super-admin (cohérence). Une fois le compte
// VÉRIFIÉ, tout est verrouillé (RLS + trigger SQL) → il passe par une DEMANDE
// de modification (submitDriverChangeRequest), appliquée après approbation.

const SELF_DOCS_BUCKET = "driver-docs";
const SELF_MAX_SCAN = 8 * 1024 * 1024;
const SELF_SCAN_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "application/pdf",
];

const selfTxt = (v: FormDataEntryValue | null): string | null => {
  const s = (v == null ? "" : String(v)).trim();
  return s === "" ? null : s;
};
const selfInt = (v: FormDataEntryValue | null): number | null => {
  const s = selfTxt(v);
  if (s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

/** Garde commune : récupère le livreur ; refuse si vérifié (sauf demande). */
async function selfGuard(): Promise<
  | { ok: true; driverId: string; verified: boolean }
  | { ok: false; error: string }
> {
  const driver = await getCurrentDriver();
  if (!driver) return { ok: false, error: "Session expirée." };
  if (driver.is_blocked) return { ok: false, error: "Compte bloqué." };
  // Le verrouillage des self-edits dépend UNIQUEMENT de la vérification.
  return { ok: true, driverId: driver.id, verified: driver.is_verified };
}

export async function saveDriverVehicleSelf(
  _prev: DriverAuthState,
  formData: FormData
): Promise<DriverAuthState> {
  const g = await selfGuard();
  if (!g.ok) return { error: g.error };
  if (g.verified) {
    return {
      error: "Profil vérifié : passez par une demande de modification.",
    };
  }
  const supabase = await createClient();
  const { error } = await supabase
    .from("drivers")
    .update({
      vehicle_type: selfTxt(formData.get("vehicle_type")),
      vehicle_brand: selfTxt(formData.get("vehicle_brand")),
      vehicle_model: selfTxt(formData.get("vehicle_model")),
      vehicle_color: selfTxt(formData.get("vehicle_color")),
      vehicle_year: selfInt(formData.get("vehicle_year")),
      vehicle_plate: selfTxt(formData.get("vehicle_plate")),
      national_id_number: selfTxt(formData.get("national_id_number")),
      id_card_number: selfTxt(formData.get("id_card_number")),
      wilaya: selfTxt(formData.get("wilaya")),
      address: selfTxt(formData.get("address")),
    })
    .eq("id", g.driverId);
  if (error) {
    if (error.message.includes("profile_locked"))
      return { error: "Profil verrouillé (compte vérifié)." };
    return { error: error.message };
  }
  revalidatePath("/driver/parametres");
  return { ok: true };
}

/**
 * Envoi d'une pièce par le livreur (1ʳᵉ fois OU ajout ultérieur). La pièce est
 * insérée en statut `pending` AVEC son scan → elle apparaît « en vérification »,
 * reste consultable mais NON modifiable/supprimable (verrouillée par la RLS) :
 * c'est déjà en cours de vérification côté admin. L'aperçu / remplacement /
 * retrait se fait AVANT l'envoi, côté client (rien n'est écrit tant que non
 * envoyé). Le scan est OBLIGATOIRE.
 */
export async function submitDriverDocument(
  _prev: DriverAuthState,
  formData: FormData
): Promise<DriverAuthState> {
  const driver = await getCurrentDriver();
  if (!driver) return { error: "Session expirée." };
  if (driver.is_blocked) return { error: "Compte bloqué." };

  const docType = selfTxt(formData.get("doc_type"));
  const allowed = ["cni", "permis", "carte_grise", "passeport", "autre"];
  if (!docType || !allowed.includes(docType))
    return { error: "Type de pièce invalide." };

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0)
    return { error: "Joignez le scan / la photo de la pièce." };
  if (file.size > SELF_MAX_SCAN)
    return { error: "Fichier trop lourd (max 8 Mo)." };
  if (!SELF_SCAN_TYPES.includes(file.type))
    return { error: "Format accepté : JPG, PNG, WEBP ou PDF." };

  const supabase = await createClient();
  const safe = (file.name || "scan").replace(/[^a-zA-Z0-9._-]/g, "_");
  const path = `${driver.id}/${globalThis.crypto.randomUUID()}-${safe}`;
  const { error: upErr } = await supabase.storage
    .from(SELF_DOCS_BUCKET)
    .upload(path, file, { contentType: file.type, upsert: false });
  if (upErr) return { error: `Upload échoué : ${upErr.message}` };

  const { error } = await supabase.from("driver_documents").insert({
    driver_id: driver.id,
    doc_type: docType,
    number: selfTxt(formData.get("number")),
    issued_at: selfTxt(formData.get("issued_at")),
    expires_at: selfTxt(formData.get("expires_at")),
    file_url: path,
    status: "pending",
  });
  if (error) {
    await supabase.storage.from(SELF_DOCS_BUCKET).remove([path]);
    return { error: error.message };
  }
  revalidatePath("/driver/parametres");
  return { ok: true };
}

export async function addDriverPayoutSelf(
  _prev: DriverAuthState,
  formData: FormData
): Promise<DriverAuthState> {
  const g = await selfGuard();
  if (!g.ok) return { error: g.error };
  if (g.verified)
    return {
      error: "Profil vérifié : passez par une demande de modification.",
    };
  const method = selfTxt(formData.get("method"));
  const allowed = ["especes", "ccp", "baridimob", "virement"];
  if (!method || !allowed.includes(method))
    return { error: "Moyen de versement invalide." };
  const supabase = await createClient();
  const { error } = await supabase.from("driver_payout_methods").insert({
    driver_id: g.driverId,
    method,
    label: selfTxt(formData.get("label")),
    account_number: selfTxt(formData.get("account_number")),
    account_name: selfTxt(formData.get("account_name")),
    is_default: formData.get("is_default") === "on",
  });
  if (error) return { error: error.message };
  revalidatePath("/driver/parametres");
  return { ok: true };
}

export async function deleteDriverPayoutSelf(
  methodId: string
): Promise<{ error?: string }> {
  const g = await selfGuard();
  if (!g.ok) return { error: g.error };
  if (g.verified) return { error: "Profil vérifié." };
  const supabase = await createClient();
  const { error } = await supabase
    .from("driver_payout_methods")
    .delete()
    .eq("id", methodId)
    .eq("driver_id", g.driverId);
  if (error) return { error: error.message };
  revalidatePath("/driver/parametres");
  return {};
}

/** Demande de modification (compte vérifié) → file d'approbation super-admin. */
export async function submitDriverChangeRequest(
  _prev: DriverAuthState,
  formData: FormData
): Promise<DriverAuthState> {
  const driver = await getCurrentDriver();
  if (!driver) return { error: "Session expirée." };
  if (driver.is_blocked) return { error: "Compte bloqué." };
  const kind = selfTxt(formData.get("kind")) ?? "other";
  const note = selfTxt(formData.get("note"));
  if (!note) return { error: "Décris la modification souhaitée." };
  const supabase = await createClient();
  const { error } = await supabase.from("driver_change_requests").insert({
    driver_id: driver.id,
    kind,
    note,
  });
  if (error) return { error: error.message };
  revalidatePath("/driver/parametres");
  return { ok: true };
}

// =============================================================================
// DEMANDES DE MODIFICATION STRUCTURÉES (livreur vérifié) — mig 0110/0111
// =============================================================================
// Le livreur vérifié ne modifie plus directement : il PROPOSE un changement
// (payload). C'est « en cours de vérification » jusqu'à approbation du
// super-admin, qui applique alors le payload aux tables réelles.

/** Refuse une 2ᵉ demande en attente du même type (anti-spam). */
async function hasPendingReq(
  supabase: Awaited<ReturnType<typeof createClient>>,
  driverId: string,
  kind: string
): Promise<boolean> {
  const { count } = await supabase
    .from("driver_change_requests")
    .select("id", { count: "exact", head: true })
    .eq("driver_id", driverId)
    .eq("kind", kind)
    .eq("status", "pending");
  return (count ?? 0) > 0;
}

export async function proposeVehicleChange(
  _prev: DriverAuthState,
  formData: FormData
): Promise<DriverAuthState> {
  const driver = await getCurrentDriver();
  if (!driver) return { error: "Session expirée." };
  if (driver.is_blocked) return { error: "Compte bloqué." };
  const supabase = await createClient();
  if (await hasPendingReq(supabase, driver.id, "vehicle"))
    return { error: "Une demande véhicule est déjà en cours de vérification." };
  const payload = {
    vehicle_type: selfTxt(formData.get("vehicle_type")),
    vehicle_brand: selfTxt(formData.get("vehicle_brand")),
    vehicle_model: selfTxt(formData.get("vehicle_model")),
    vehicle_color: selfTxt(formData.get("vehicle_color")),
    vehicle_year: selfInt(formData.get("vehicle_year")),
    vehicle_plate: selfTxt(formData.get("vehicle_plate")),
    national_id_number: selfTxt(formData.get("national_id_number")),
    id_card_number: selfTxt(formData.get("id_card_number")),
    wilaya: selfTxt(formData.get("wilaya")),
    address: selfTxt(formData.get("address")),
  };
  const { error } = await supabase.from("driver_change_requests").insert({
    driver_id: driver.id,
    kind: "vehicle",
    note: "Mise à jour véhicule & identité",
    payload,
  });
  if (error) return { error: error.message };
  revalidatePath("/driver/parametres");
  return { ok: true };
}

export async function proposePayoutChange(
  _prev: DriverAuthState,
  formData: FormData
): Promise<DriverAuthState> {
  const driver = await getCurrentDriver();
  if (!driver) return { error: "Session expirée." };
  if (driver.is_blocked) return { error: "Compte bloqué." };
  const method = selfTxt(formData.get("method"));
  const allowed = ["especes", "ccp", "baridimob", "virement"];
  if (!method || !allowed.includes(method))
    return { error: "Moyen de versement invalide." };
  const supabase = await createClient();
  if (await hasPendingReq(supabase, driver.id, "payout"))
    return {
      error: "Une demande versement est déjà en cours de vérification.",
    };
  const payload = {
    method,
    label: selfTxt(formData.get("label")),
    account_number: selfTxt(formData.get("account_number")),
    account_name: selfTxt(formData.get("account_name")),
    is_default: formData.get("is_default") === "on",
  };
  const { error } = await supabase.from("driver_change_requests").insert({
    driver_id: driver.id,
    kind: "payout",
    note: `Nouveau moyen de versement (${method})`,
    payload,
  });
  if (error) return { error: error.message };
  revalidatePath("/driver/parametres");
  return { ok: true };
}

// (proposeDocumentChange retiré : les pièces passent désormais par
//  submitDriverDocument — statut `pending` sur la pièce, verrouillée après envoi.)

// ---------------------------------------------------------------------------
// Compteurs de TOURNÉES par commerçant (pour le dispatch tournée temps réel
// côté livreur : détection d'une NOUVELLE commande en tournée → bandeau in-app).
// RPC SECURITY DEFINER déjà existante (driver_delivery_counts) ; auth requise.
// ---------------------------------------------------------------------------
export type DriverTourCount = {
  mdId: string;
  merchantName: string;
  tourPending: number;
};

export async function fetchDriverTourCounts(): Promise<DriverTourCount[]> {
  const supabase = await createClient();
  const driver = await getCurrentDriver();
  if (!driver) return [];
  const { data } = await supabase.rpc("driver_delivery_counts");
  type Row = {
    merchant_driver_id: string;
    merchant_name: string;
    tours_enabled: boolean;
    tour_pending: number;
  };
  return ((data ?? []) as Row[])
    .filter((c) => c.tours_enabled)
    .map((c) => ({
      mdId: c.merchant_driver_id,
      merchantName: c.merchant_name,
      tourPending: c.tour_pending ?? 0,
    }));
}

// ---------------------------------------------------------------------------
// Lecture des GAINS (grand livre) — pour TanStack Query côté client.
// Auth + RLS appliqués à chaque appel (jamais de données d'un autre livreur).
// ---------------------------------------------------------------------------
export async function fetchDriverGains(): Promise<{
  ok: boolean;
  entries: GainsEntry[];
}> {
  const supabase = await createClient();
  const driver = await getCurrentDriver();
  if (!driver) return { ok: false, entries: [] };
  const { data } = await supabase
    .from("delivery_ledger")
    .select("id, type, amount_da, note, created_at, merchant_id")
    .eq("driver_id", driver.id)
    .order("created_at", { ascending: false })
    .limit(200);
  return { ok: true, entries: (data ?? []) as GainsEntry[] };
}

// ---------------------------------------------------------------------------
// Résumé du COMPTE (hero + stats + jauge encours) — pour TanStack Query.
// Léger (pas d'URLs signées) : les pièces/formulaires sont streamés à part.
// Auth + RLS appliqués à chaque appel.
// ---------------------------------------------------------------------------
function driverInitials(name: string): string {
  const parts = name.trim().split(/\s+/).filter(Boolean);
  if (parts.length === 0) return "?";
  if (parts.length === 1) return parts[0].charAt(0).toUpperCase();
  return (parts[0].charAt(0) + parts[parts.length - 1].charAt(0)).toUpperCase();
}

export async function fetchDriverCompteSummary(): Promise<CompteData | null> {
  const supabase = await createClient();
  const driver = await getCurrentDriver();
  if (!driver) return null;

  const [
    { data: prof },
    { count: courses },
    { data: outstanding },
    { data: settings },
  ] = await Promise.all([
    supabase
      .from("drivers")
      .select(
        "rating_avg, rating_count, vehicle_label, vehicle_plate, payout_method, payout_details, joined_year, created_at"
      )
      .eq("id", driver.id)
      .maybeSingle(),
    supabase
      .from("orders")
      .select("id", { count: "exact", head: true })
      .eq("delivery_driver_id", driver.id)
      .not("delivery_delivered_at", "is", null),
    supabase.rpc("driver_outstanding", { p_driver_id: driver.id }),
    supabase
      .from("platform_settings")
      .select("driver_float_cap_da")
      .eq("id", true)
      .single(),
  ]);

  const p = (prof ?? {}) as {
    rating_avg?: number;
    rating_count?: number;
    vehicle_label?: string | null;
    vehicle_plate?: string | null;
    payout_method?: string | null;
    payout_details?: string | null;
    joined_year?: number | null;
    created_at?: string;
  };
  const joinedYear =
    p.joined_year ??
    (p.created_at ? new Date(p.created_at).getFullYear() : null);

  return {
    initials: driverInitials(driver.full_name),
    avatarUrl: driver.avatar_url,
    fullName: driver.full_name,
    ratingAvg: Number(p.rating_avg ?? 0),
    ratingCount: p.rating_count ?? 0,
    coursesCount: courses ?? 0,
    joinedYear,
    verified: driver.is_verified,
    frozen: driver.is_frozen,
    vehicleLabel: p.vehicle_label ?? null,
    vehiclePlate: p.vehicle_plate ?? null,
    payoutMethod: p.payout_method ?? null,
    payoutDetails: p.payout_details ?? null,
    outstandingDa: Number(outstanding ?? 0),
    capDa: Number(
      (settings as { driver_float_cap_da?: number } | null)
        ?.driver_float_cap_da ?? 8000
    ),
  };
}

export type DeliveryHistoryData = {
  rows: {
    id: string;
    order_number: string | null;
    customer_name: string | null;
    total_da: number | null;
    delivery_fee_da: number | null;
    driver_net_da: number | null;
    payment_method: "cash" | "online";
    delivery_mode: "express" | "tour" | null;
    status: string;
    delivery_address_text: string | null;
    delivery_delivered_at: string | null;
    delivery_picked_up_at: string | null;
    created_at: string;
    merchant_id: string;
    validated_without_code: boolean;
  }[];
  merchants: { id: string; name: string }[];
};

/**
 * Historique des livraisons du livreur connecté (≤ 500 dernières) + noms des
 * commerçants concernés. Server action APPELÉE PAR LE CLIENT (TanStack Query) →
 * la page /driver/historique ne fait plus que l'auth, le contenu est mis en
 * cache côté client et réaffiché instantanément au retour (plus de
 * re-téléchargement à chaque visite). Auth + RLS revérifiées ici (source de
 * vérité). Confidentialité : le nom du client est masqué une fois la commande
 * livrée/terminée/annulée (le livreur n'a plus besoin de l'info personnelle).
 */
export async function getDeliveryHistory(): Promise<DeliveryHistoryData> {
  const driver = await getCurrentDriver();
  if (!driver) return { rows: [], merchants: [] };
  const supabase = await createClient();

  const { data: orders } = await supabase
    .from("orders")
    .select(
      `id, order_number, customer_name, total_da, delivery_fee_da, driver_net_da, payment_method,
       delivery_mode, status, delivery_address_text, delivery_delivered_at,
       delivery_picked_up_at, created_at, merchant_id, validated_without_code`
    )
    .eq("delivery_driver_id", driver.id)
    .order("created_at", { ascending: false })
    .limit(500);

  const rows = ((orders ?? []) as DeliveryHistoryData["rows"]).map((r) => {
    const done =
      r.status === "completed" ||
      r.status === "cancelled" ||
      r.delivery_delivered_at != null;
    return done ? { ...r, customer_name: null } : r;
  });

  const merchantIds = Array.from(new Set(rows.map((r) => r.merchant_id)));
  const { data: merchants } = merchantIds.length
    ? await supabase
        .from("merchants_public")
        .select("id, name")
        .in("id", merchantIds)
    : { data: [] as { id: string; name: string }[] };

  return {
    rows,
    merchants: (merchants ?? []) as { id: string; name: string }[],
  };
}
