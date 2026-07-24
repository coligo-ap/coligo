"use server";

import { redirect } from "next/navigation";
import { markSignedOut } from "@/lib/auth/mark-signed-out";
import { revalidatePath } from "next/cache";
import { getLocale } from "next-intl/server";
import { z } from "zod";
import { validateUploadedFile } from "@/lib/security/file-validation";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  fraudNoteOfferDecisionByUser,
  fraudDriverEventByUser,
} from "@/lib/fraud/events";
import { maybeFraudTick } from "@/lib/fraud/tick";
import { getIdvCompliance, idvSubmissionBlock } from "@/lib/idv/compliance";
import { openIdvManualFallback } from "@/lib/idv/fallback";
import {
  canonicalPhone,
  getCurrentDriver,
  phoneToEmail,
} from "@/lib/auth/driver";
import { DZ_PHONE_ERROR, DZ_PHONE_ERROR_AR } from "@/lib/dz/phone";
import {
  getDriverGate,
  NOT_ACTIVE_ERROR,
  type DriverGate,
} from "@/lib/auth/driver-gate";

/** Erreurs des parcours d'auth, dans la langue du cookie NEXT_LOCALE. */
async function authTr(fr: string, ar: string): Promise<string> {
  return (await getLocale()) === "ar" ? ar : fr;
}
import {
  kycReport,
  type KycMethod,
  requiredDocTypes,
  idDocKindOf,
  isAdult,
  isMotorized,
  VEHICLE_TYPES,
  type DriverDocType,
  type KycProfile,
  type KycDocs,
  type KycReport,
} from "@/lib/driver/kyc";
import { hashReferralCode } from "@/lib/drivers/referral-code";
import type { CompteData } from "@/components/driver/profile/compte-view";
import { isWilaya } from "@/lib/dz/wilayas";
import {
  notifyMerchantNewDriverRequest,
  notifyCustomerEnRoute,
  notifyCustomerArrived,
  notifyCustomerStatusChange,
} from "@/lib/fcm/triggers";

export type DriverAuthState = { error?: string; ok?: boolean };

/**
 * GARDE SERVEUR des actions opérationnelles (mise en ligne, rejoindre un
 * commerçant, tournées, courses…). Aucune de ces actions ne s'exécute pour un
 * livreur dont le compte n'est pas ACTIF — même appelée directement, sans
 * passer par l'interface. La base applique la même règle (mig 0352) : cette
 * garde donne simplement un message clair au lieu d'une erreur SQL.
 */
async function assertActiveDriver(): Promise<
  { ok: true; gate: DriverGate } | { ok: false; error: string }
> {
  const gate = await getDriverGate();
  if (!gate) return { ok: false, error: "Session expirée." };
  if (gate.isBlocked) return { ok: false, error: "Compte bloqué." };
  if (gate.stage !== "active") return { ok: false, error: NOT_ACTIVE_ERROR };
  return { ok: true, gate };
}

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
  // L'auth livreur reste basée sur le TÉLÉPHONE (email synthétisé) ; l'email
  // réel saisi est stocké sur la table métier `drivers`. Le numéro canonique et
  // l'email dérivent de la MÊME normalisation : « 0603044620 » et
  // « +213 603044620 » désignent donc bien le même compte.
  const phone = canonicalPhone(parsed.data.phone);
  const authEmail = phoneToEmail(parsed.data.phone);
  if (!phone || !authEmail)
    return { error: await authTr(DZ_PHONE_ERROR, DZ_PHONE_ERROR_AR) };
  const fullName = `${parsed.data.first_name} ${parsed.data.last_name}`;

  const { data: signup, error } = await supabase.auth.signUp({
    email: authEmail,
    password: parsed.data.password,
  });
  if (error || !signup.user) {
    if (error?.message.includes("registered")) {
      return {
        error: await authTr(
          "Ce numéro est déjà enregistré.",
          "هذا الرقم مسجّل بالفعل."
        ),
      };
    }
    return {
      error:
        error?.message ?? (await authTr("Échec inscription.", "فشل التسجيل.")),
    };
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

  // Le compte vient d'être créé : AUCUNE fonctionnalité métier n'est ouverte.
  // Le livreur est envoyé sur son dossier de vérification d'identité — pas sur
  // « Rejoindre un commerçant », qui reste inaccessible jusqu'à l'activation.
  // Un éventuel `next` est volontairement ignoré ici (il serait de toute façon
  // rejeté par la garde de la page cible).
  redirect("/driver/inscription");
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
  const badCreds = await authTr(
    "Téléphone ou mot de passe incorrect.",
    "رقم الهاتف أو كلمة المرور غير صحيحة."
  );
  const email = phoneToEmail(parsed.data.phone);
  if (!email) return { error: badCreds };
  const { error } = await supabase.auth.signInWithPassword({
    email,
    password: parsed.data.password,
  });
  if (error) {
    return { error: badCreds };
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
  await markSignedOut();
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
  const phone = canonicalPhone(parsed.data.phone);
  if (!phone) return { error: DZ_PHONE_ERROR };
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

  // Rejoindre un commerçant est une fonctionnalité opérationnelle : interdite
  // tant que l'équipe Coligo n'a pas vérifié le compte. Le trigger SQL
  // `merchant_drivers_verified_guard_trg` refuserait de toute façon l'insertion.
  const guard = await assertActiveDriver();
  if (!guard.ok) return { error: guard.error };

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { error: "Session expirée." };

  const driver = { id: guard.gate.id, full_name: guard.gate.fullName };

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
  // Se mettre en ligne exige un compte activé (le retour hors ligne est libre).
  if (status !== "offline") {
    const guard = await assertActiveDriver();
    if (!guard.ok) return { error: guard.error };
  }
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
  // Compte non activé : la mise en ligne est refusée, quoi qu'affiche l'écran.
  if (status !== "offline") {
    const guard = await assertActiveDriver();
    if (!guard.ok) {
      return { ok: false, changed: 0, error: "NOT_ACTIVE" };
    }
  }
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
  if (row.ok) {
    revalidatePath("/driver");
    // Anti-fraude : refus explicite → trace + remise à zéro des non-réponses
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) await fraudNoteOfferDecisionByUser(user.id, orderId, "decline");
    })();
  }
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
    // Anti-fraude : pickup = acceptation effective de l'offre Express
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user) await fraudNoteOfferDecisionByUser(user.id, orderId, "accept");
    })();
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
  // Anti-fraude : appel livreur → client tracé (détecteur « annulation après
  // appel » — demande d'annuler hors plateforme).
  if (row?.ok) {
    void (async () => {
      const {
        data: { user },
      } = await supabase.auth.getUser();
      if (user)
        await fraudDriverEventByUser(user.id, "call_initiated", orderId, {
          from: "driver",
        });
    })();
  }
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
    // Un compte non activé n'est jamais « présent » : il ne doit apparaître ni
    // dans le dispatch géolocalisé ni dans les cibles de push. (Le RPC applique
    // aussi la règle — on évite juste l'aller-retour.)
    const guard = await assertActiveDriver();
    if (!guard.ok) return;
    const supabase = await createClient();
    const rpc = supabase.rpc.bind(supabase) as unknown as (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{ error: { message: string } | null }>;
    await rpc("driver_heartbeat", { p_lat: lat, p_lng: lng });
    // Anti-fraude : présence miroir (auto-déconnexion des présences muettes)
    // + sweep opportuniste throttlé.
    void rpc("fraud_touch_driver_presence", {
      p_lat: lat,
      p_lng: lng,
      p_offer: null,
    });
    void maybeFraudTick();
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
): Promise<{ orderId?: string; forcedOffline?: boolean }> {
  try {
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return {};
    // Aucune course n'est attribuée à un compte non activé.
    const guard = await assertActiveDriver();
    if (!guard.ok) return {};
    const supabase = await createClient();
    const rpc = supabase.rpc.bind(supabase) as unknown as (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{ data: unknown; error: { message: string } | null }>;
    // Anti-fraude (mig 0374) : présence + détection des offres restées sans
    // réponse. Si le livreur est en HORS-LIGNE FORCÉ (offres ignorées en
    // série), on ne pull PAS — l'UI repasse le bouton sur STOP.
    const { data: touch } = await rpc("fraud_touch_driver_presence", {
      p_lat: lat,
      p_lng: lng,
      p_offer: null,
    });
    if ((touch as { forced_offline?: boolean } | null)?.forced_offline) {
      return { forcedOffline: true };
    }
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
    // L'offre attribuée est enregistrée comme « vue » — si elle repart au canal
    // sans décision (ni pickup ni refus), elle comptera comme ignorée.
    void rpc("fraud_touch_driver_presence", {
      p_lat: lat,
      p_lng: lng,
      p_offer: row.res_order_id,
    });
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
// PARCOURS D'INSCRIPTION — vérification d'identité (KYC), envoi du dossier,
// accusé de réception de l'activation et choix du mode d'activité (mig 0352).
// =============================================================================
// Toutes ces actions écrivent via service_role APRÈS avoir revalidé l'étape du
// livreur côté serveur : les colonnes du parcours (`submitted_at`,
// `verified_ack_at`, …) sont protégées en base contre toute écriture directe
// par le livreur (trigger `drivers_self_update_guard`).

const KYC_BUCKET = "driver-docs";
const KYC_MAX_SCAN = 8 * 1024 * 1024;

/** Pièces acceptées dans le dossier d'inscription. */
const KYC_DOC_TYPES: DriverDocType[] = [
  "cni",
  "selfie",
  "permis",
  "carte_grise",
  "assurance",
];

export type KycDocView = {
  id: string;
  docType: DriverDocType;
  status: string;
  reviewNote: string | null;
  scanUrl: string | null;
};

export type DriverKycData = {
  profile: KycProfile;
  docs: KycDocView[];
  report: KycReport;
  rejectionReason: string | null;
  /** Vérification d'identité : méthode choisie + état du parcours automatique. */
  idv: {
    /** La vérification automatique est-elle proposée à ce livreur ? */
    available: boolean;
    /** Le super-admin l'a rendue OBLIGATOIRE → aucun choix possible. */
    forced: boolean;
    /** Méthode retenue ('instant' | 'manual'), null tant qu'il n'a pas choisi. */
    method: KycMethod | null;
    /** Identité confirmée par le parcours automatique. */
    verified: boolean;
    /** Dossier en cours d'analyse ou de revue humaine. */
    inProgress: boolean;
    /** Refusé par la vérification automatique → recours par l'examen humain. */
    rejected: boolean;
    /** Route du parcours. */
    route: string;
  };
};

/** Le livreur peut-il encore MODIFIER son dossier ? (avant envoi seulement) */
async function requireEditableDossier(): Promise<
  { ok: true; gate: DriverGate } | { ok: false; error: string }
> {
  const gate = await getDriverGate();
  if (!gate) return { ok: false, error: "Session expirée." };
  if (gate.isBlocked) return { ok: false, error: "Compte bloqué." };
  if (gate.stage !== "kyc") {
    return {
      ok: false,
      error:
        "Votre dossier a déjà été transmis à l'équipe Coligo : il n'est plus modifiable.",
    };
  }
  return { ok: true, gate };
}

/** Lit le dossier courant (profil + pièces + avancement). */
export async function getDriverKyc(): Promise<DriverKycData | null> {
  const gate = await getDriverGate();
  if (!gate) return null;

  const admin = createAdminClient();
  const [{ data: prof }, { data: docRows }, idv, { data: methodRow }] =
    await Promise.all([
      admin
        .from("drivers")
        .select(
          `full_name, date_of_birth, phone, email, wilaya, address, id_card_number,
         national_id_number, vehicle_type, vehicle_brand, vehicle_model,
         vehicle_plate, vehicle_color, vehicle_year`
        )
        .eq("id", gate.id)
        .maybeSingle(),
      admin
        .from("driver_documents")
        .select("id, doc_type, status, review_note, file_url")
        .eq("driver_id", gate.id)
        .order("created_at", { ascending: false }),
      getIdvCompliance("driver"),
      // `kyc_method` (mig 0369) pas encore dans database.types.ts généré → cast.
      (
        admin.from.bind(admin) as unknown as (t: string) => {
          select: (c: string) => {
            eq: (
              c: string,
              v: string
            ) => {
              maybeSingle: () => Promise<{
                data: { kyc_method: string | null } | null;
              }>;
            };
          };
        }
      )("drivers")
        .select("kyc_method")
        .eq("id", gate.id)
        .maybeSingle(),
    ]);
  if (!prof) return null;

  const docs: KycDocView[] = await Promise.all(
    (docRows ?? []).map(async (d) => {
      let scanUrl: string | null = null;
      if (d.file_url) {
        const { data: s } = await admin.storage
          .from(KYC_BUCKET)
          .createSignedUrl(d.file_url, 3600);
        scanUrl = s?.signedUrl ?? null;
      }
      return {
        id: d.id,
        docType: d.doc_type as DriverDocType,
        status: d.status,
        reviewNote: d.review_note,
        scanUrl,
      };
    })
  );

  const profile = prof as KycProfile;
  const present: KycDocs = {};
  for (const d of docs) present[d.docType] = true;

  // Méthode retenue : imposée à « instant » quand l'IDV est obligatoire — SAUF
  // si la machine a déjà refusé ce livreur : le recours (examen humain sur
  // pièces) rouvre alors le choix, sinon un refus à tort serait sans issue.
  const stored = (methodRow?.kyc_method ?? null) as KycMethod | null;
  const appealable = idv.rejected || idv.manualFallback;
  const forced = idv.enabled && idv.required && !appealable;
  const method: KycMethod | null = forced
    ? "instant"
    : idv.enabled
      ? stored
      : "manual";

  return {
    profile,
    docs,
    report: kycReport(profile, present, idDocKindOf(present), {
      method,
      verified: idv.verified,
    }),
    rejectionReason: gate.rejectionReason,
    idv: {
      available: idv.enabled,
      forced,
      method,
      verified: idv.verified,
      inProgress: idv.inProgress,
      rejected: idv.rejected,
      route: idv.route,
    },
  };
}

/**
 * Choix de la MÉTHODE de vérification d'identité (étape 2 de l'inscription).
 * Le serveur ne fait jamais confiance au client : si le super-admin a rendu la
 * vérification automatique OBLIGATOIRE, le choix est ignoré et « instant » est
 * imposé ; si elle n'est pas publiée, seul « manual » existe.
 */
export async function setDriverKycMethod(
  method: KycMethod
): Promise<{ ok: boolean; error?: string; method?: KycMethod }> {
  const g = await requireEditableDossier();
  if (!g.ok) return { ok: false, error: g.error };
  if (method !== "manual" && method !== "instant") {
    return { ok: false, error: "Méthode inconnue." };
  }

  const idv = await getIdvCompliance("driver");
  // La vérification automatique a REFUSÉ : la voie manuelle redevient ouverte,
  // même quand l'IDV est obligatoire — sinon un refus à tort (document abîmé,
  // photo de nuit) enfermerait le livreur à vie, sans recours. Choisir « manuel »
  // à ce moment-là, c'est demander l'examen par l'équipe Coligo.
  const appealable = idv.rejected || idv.manualFallback;
  const effective: KycMethod = !idv.enabled
    ? "manual"
    : idv.required && !appealable
      ? "instant"
      : method;

  if (effective === "manual" && idv.rejected) {
    const res = await openIdvManualFallback(g.gate.userId, "driver");
    if (!res.ok) return { ok: false, error: res.error };
  }

  const admin = createAdminClient();
  const { error } = await (
    admin.from.bind(admin) as unknown as (t: string) => {
      update: (v: Record<string, unknown>) => {
        eq: (
          c: string,
          v: string
        ) => Promise<{ error: { message: string } | null }>;
      };
    }
  )("drivers")
    .update({ kyc_method: effective })
    .eq("id", g.gate.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/driver/inscription");
  return { ok: true, method: effective };
}

const txt = (v: FormDataEntryValue | null): string | null => {
  const s = (v == null ? "" : String(v)).trim();
  return s === "" ? null : s;
};
const int = (v: FormDataEntryValue | null): number | null => {
  const s = txt(v);
  if (s == null) return null;
  const n = Number(s);
  return Number.isFinite(n) ? Math.trunc(n) : null;
};

const VEHICLE_TYPE_VALUES: string[] = VEHICLE_TYPES.map((v) => v.value);

/**
 * Enregistre les informations du dossier (sections « Informations personnelles »
 * et « Véhicule »). Le dossier est enregistrable même INCOMPLET — le livreur
 * peut reprendre plus tard. Ce qui est renseigné est en revanche validé tout de
 * suite (âge minimum, wilaya réelle, type de véhicule connu). C'est
 * `submitDriverDossier` qui exige un dossier complet.
 */
export async function saveDriverKycProfile(
  _prev: DriverAuthState,
  formData: FormData
): Promise<DriverAuthState> {
  const g = await requireEditableDossier();
  if (!g.ok) return { error: g.error };

  const fullName = txt(formData.get("full_name"));
  if (fullName && fullName.length < 3)
    return { error: "Nom complet trop court." };

  const dob = txt(formData.get("date_of_birth"));
  if (dob) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(dob))
      return { error: "Date de naissance invalide." };
    if (!isAdult(dob))
      return { error: "Vous devez avoir au moins 18 ans pour livrer." };
  }

  const wilaya = txt(formData.get("wilaya"));
  if (wilaya && !isWilaya(wilaya)) return { error: "Wilaya invalide." };

  const vehicleType = txt(formData.get("vehicle_type"));
  if (vehicleType && !VEHICLE_TYPE_VALUES.includes(vehicleType))
    return { error: "Type de véhicule invalide." };

  // Changer de véhicule pour un non motorisé purge les champs devenus sans objet.
  const motorized = isMotorized(vehicleType);

  // ON N'ÉCRIT QUE CE QUE LE FORMULAIRE A ENVOYÉ. Adresse, numéro de pièce,
  // NIN et année du véhicule ne sont plus demandés au livreur, mais restent
  // affichés côté super-admin : un `update` inconditionnel les remettrait à
  // `null` au premier enregistrement, effaçant ce que les livreurs déjà inscrits
  // avaient saisi.
  const admin = createAdminClient();
  const { error } = await admin
    .from("drivers")
    .update({
      full_name: fullName ?? g.gate.fullName,
      date_of_birth: dob,
      wilaya,
      email: txt(formData.get("email")),
      vehicle_type: vehicleType,
      vehicle_brand: txt(formData.get("vehicle_brand")),
      vehicle_model: txt(formData.get("vehicle_model")),
      vehicle_plate: motorized ? txt(formData.get("vehicle_plate")) : null,
      vehicle_color: txt(formData.get("vehicle_color")),
      ...(formData.has("address")
        ? { address: txt(formData.get("address")) }
        : {}),
      ...(formData.has("id_card_number")
        ? { id_card_number: txt(formData.get("id_card_number")) }
        : {}),
      ...(formData.has("national_id_number")
        ? { national_id_number: txt(formData.get("national_id_number")) }
        : {}),
      ...(formData.has("vehicle_year")
        ? { vehicle_year: int(formData.get("vehicle_year")) }
        : {}),
    })
    .eq("id", g.gate.id);
  if (error) return { error: error.message };

  revalidatePath("/driver/inscription");
  return { ok: true };
}

/**
 * Dépose (ou remplace) une pièce du dossier. Tant que le dossier n'est pas
 * transmis, le livreur peut corriger une photo floue : l'ancienne ligne et son
 * fichier sont supprimés. Une fois transmis, plus aucune modification (garde
 * `requireEditableDossier`).
 *
 * La pièce créée est RENVOYÉE au client (avec son URL signée d'aperçu) : le
 * formulaire se met à jour sans `router.refresh()`. Un rafraîchissement du
 * rendu serveur à chaque dépôt remonterait les champs de fichier au milieu de
 * la saisie, et les pièces choisies pendant ce laps de temps seraient perdues.
 */
export async function uploadDriverKycDocument(
  formData: FormData
): Promise<{ ok: boolean; error?: string; doc?: KycDocView }> {
  const g = await requireEditableDossier();
  if (!g.ok) return { ok: false, error: g.error };

  const docType = txt(formData.get("doc_type")) as DriverDocType | null;
  if (!docType || !KYC_DOC_TYPES.includes(docType)) {
    return { ok: false, error: "Type de pièce invalide." };
  }

  // Le selfie doit être une PHOTO (jamais un PDF) ; signature binaire vérifiée
  // côté serveur — le type déclaré par le navigateur n'est jamais cru.
  const v = await validateUploadedFile(formData.get("file"), {
    kind: docType === "selfie" ? "image" : "image-pdf",
    maxBytes: KYC_MAX_SCAN,
  });
  if (!v.ok) return { ok: false, error: v.error };

  const admin = createAdminClient();
  const path = `${g.gate.id}/${docType}-${globalThis.crypto.randomUUID()}.${v.ext}`;
  const { error: upErr } = await admin.storage
    .from(KYC_BUCKET)
    .upload(path, v.bytes, { contentType: v.mime, upsert: false });
  if (upErr) return { ok: false, error: `Envoi échoué : ${upErr.message}` };

  // Remplace l'éventuelle pièce précédente du même type (fichier + ligne).
  const { data: previous } = await admin
    .from("driver_documents")
    .select("id, file_url")
    .eq("driver_id", g.gate.id)
    .eq("doc_type", docType);

  const { data: inserted, error } = await admin
    .from("driver_documents")
    .insert({
      driver_id: g.gate.id,
      doc_type: docType,
      number: txt(formData.get("number")),
      expires_at: txt(formData.get("expires_at")),
      file_url: path,
      status: "pending",
    })
    .select("id")
    .single();
  if (error || !inserted) {
    await admin.storage.from(KYC_BUCKET).remove([path]);
    return { ok: false, error: error?.message ?? "Enregistrement impossible." };
  }

  for (const p of previous ?? []) {
    await admin.from("driver_documents").delete().eq("id", p.id);
    if (p.file_url) await admin.storage.from(KYC_BUCKET).remove([p.file_url]);
  }

  if (docType === "selfie") {
    await admin
      .from("drivers")
      .update({ selfie_url: path })
      .eq("id", g.gate.id);
  }

  const { data: signed } = await admin.storage
    .from(KYC_BUCKET)
    .createSignedUrl(path, 3600);

  return {
    ok: true,
    doc: {
      id: inserted.id,
      docType,
      status: "pending",
      reviewNote: null,
      scanUrl: signed?.signedUrl ?? null,
    },
  };
}

/** Retire une pièce du dossier (avant envoi uniquement). */
export async function removeDriverKycDocument(
  docType: string
): Promise<{ ok: boolean; error?: string }> {
  const g = await requireEditableDossier();
  if (!g.ok) return { ok: false, error: g.error };
  if (!KYC_DOC_TYPES.includes(docType as DriverDocType)) {
    return { ok: false, error: "Type de pièce invalide." };
  }

  const admin = createAdminClient();
  const { data: rows } = await admin
    .from("driver_documents")
    .select("id, file_url")
    .eq("driver_id", g.gate.id)
    .eq("doc_type", docType);

  for (const r of rows ?? []) {
    await admin.from("driver_documents").delete().eq("id", r.id);
    if (r.file_url) await admin.storage.from(KYC_BUCKET).remove([r.file_url]);
  }
  if (docType === "selfie") {
    await admin
      .from("drivers")
      .update({ selfie_url: null })
      .eq("id", g.gate.id);
  }

  return { ok: true };
}

/**
 * ENVOI DU DOSSIER. Le rapport KYC est recalculé ICI, à partir de la base :
 * un dossier incomplet ne peut pas être transmis, même si le formulaire a été
 * contourné. Le compte passe alors « en attente de validation » et le livreur
 * n'a plus accès qu'à l'écran de suivi.
 */
export async function submitDriverDossier(): Promise<{
  ok: boolean;
  error?: string;
  missing?: string[];
}> {
  const g = await requireEditableDossier();
  if (!g.ok) return { ok: false, error: g.error };

  const admin = createAdminClient();
  const [{ data: prof }, { data: docRows }] = await Promise.all([
    admin
      .from("drivers")
      .select(
        `full_name, date_of_birth, phone, email, wilaya, address, id_card_number,
         national_id_number, vehicle_type, vehicle_brand, vehicle_model,
         vehicle_plate, vehicle_color, vehicle_year`
      )
      .eq("id", g.gate.id)
      .maybeSingle(),
    admin
      .from("driver_documents")
      .select("doc_type")
      .eq("driver_id", g.gate.id),
  ]);
  if (!prof) return { ok: false, error: "Profil livreur introuvable." };

  const present: KycDocs = {};
  for (const d of docRows ?? []) present[d.doc_type as DriverDocType] = true;

  // Méthode de vérification retenue (relue en base : le client ne décide pas)
  // + état réel du parcours automatique.
  const idv = await getIdvCompliance("driver");
  const { data: methodRow } = await (
    admin.from.bind(admin) as unknown as (t: string) => {
      select: (c: string) => {
        eq: (
          c: string,
          v: string
        ) => {
          maybeSingle: () => Promise<{
            data: { kyc_method: string | null } | null;
          }>;
        };
      };
    }
  )("drivers")
    .select("kyc_method")
    .eq("id", g.gate.id)
    .maybeSingle();
  const method: KycMethod | null =
    idv.enabled && idv.required
      ? "instant"
      : idv.enabled
        ? ((methodRow?.kyc_method ?? null) as KycMethod | null)
        : "manual";

  const report = kycReport(prof as KycProfile, present, idDocKindOf(present), {
    method,
    verified: idv.verified,
  });
  if (!report.complete) {
    return {
      ok: false,
      error: "Votre dossier est incomplet.",
      missing: report.missing,
    };
  }

  // Voie « instantanée » choisie : l'identité doit être RÉELLEMENT confirmée —
  // sans ça, un livreur pourrait choisir cette voie et n'envoyer aucune pièce.
  if (method === "instant" && !idv.verified) {
    return {
      ok: false,
      error: idv.inProgress
        ? "Votre identité est en cours de vérification. Vous pourrez transmettre votre dossier dès qu'elle sera confirmée."
        : "Terminez la vérification instantanée de votre identité (document + selfie).",
      missing: ["Vérification d'identité"],
    };
  }

  // VÉRIFICATION D'IDENTITÉ automatique (IDV) — garde PARTAGÉE par les trois
  // espaces (lib/idv/compliance) : un seul endroit décide.
  const idvBlock = await idvSubmissionBlock("driver", { method });
  if (idvBlock) return { ok: false, ...idvBlock };
  // Ceinture et bretelles : la liste des pièces attendues doit être couverte.
  // La nature de la pièce d'identité se relit de ce qui a été déposé — c'est la
  // même règle que celle affichée au livreur, jamais une seconde définition.
  const missingDocs = requiredDocTypes(
    prof.vehicle_type,
    idDocKindOf(present),
    method
  ).filter((t) => !present[t]);
  if (missingDocs.length > 0) {
    return { ok: false, error: "Des pièces obligatoires sont manquantes." };
  }

  const { error } = await admin
    .from("drivers")
    .update({
      submitted_at: new Date().toISOString(),
      rejected_at: null,
      rejection_reason: null,
    })
    .eq("id", g.gate.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/driver", "layout");
  return { ok: true };
}

/**
 * Marque toutes les notifications internes du livreur comme lues. Passe par une
 * RPC SECURITY DEFINER : il n'existe AUCUNE policy UPDATE pour le livreur, donc
 * il ne peut pas réécrire le contenu d'une notification. Best-effort.
 */
export async function markDriverNotificationsRead(): Promise<void> {
  try {
    const supabase = await createClient();
    const rpc = supabase.rpc.bind(supabase) as unknown as (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{ error: unknown }>;
    await rpc("driver_mark_notifications_read", {});
  } catch {
    /* no-op : le badge se recalculera au prochain rendu */
  }
}

/**
 * Le livreur a vu l'écran « Compte vérifié ». On mémorise l'accusé afin de ne
 * plus le lui présenter, tout en le laissant sur le choix du mode d'activité.
 */
export async function ackDriverVerified(): Promise<DriverAuthState> {
  const gate = await getDriverGate();
  if (!gate) return { error: "Session expirée." };
  if (!gate.isVerified) return { error: NOT_ACTIVE_ERROR };
  if (gate.stage !== "welcome") return { ok: true };

  const admin = createAdminClient();
  const { error } = await admin
    .from("drivers")
    .update({ verified_ack_at: new Date().toISOString() })
    .eq("id", gate.id)
    .is("verified_ack_at", null);
  if (error) return { error: error.message };
  return { ok: true };
}

/**
 * Fin du parcours : le livreur a choisi son mode d'activité. Le compte devient
 * ACTIF (`onboarding_done_at`) et toutes les fonctionnalités s'ouvrent.
 * Renvoie la route de destination (rejoindre un commerçant, ou accueil Express).
 */
export async function finishDriverOnboarding(
  mode: "merchant" | "express"
): Promise<{ ok: boolean; route?: string; error?: string }> {
  const gate = await getDriverGate();
  if (!gate) return { ok: false, error: "Session expirée." };
  if (gate.isBlocked) return { ok: false, error: "Compte bloqué." };
  if (!gate.isVerified) return { ok: false, error: NOT_ACTIVE_ERROR };

  const now = new Date().toISOString();
  const admin = createAdminClient();
  // L'accusé de lecture n'est posé qu'une fois (il date le 1ᵉʳ affichage des
  // félicitations) ; la fin du parcours, elle, est toujours réécrite ici.
  await admin
    .from("drivers")
    .update({ verified_ack_at: now })
    .eq("id", gate.id)
    .is("verified_ack_at", null);
  const { error } = await admin
    .from("drivers")
    .update({ onboarding_done_at: now })
    .eq("id", gate.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/driver", "layout");
  return { ok: true, route: mode === "merchant" ? "/driver/codes" : "/driver" };
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

const selfTxt = (v: FormDataEntryValue | null): string | null => {
  const s = (v == null ? "" : String(v)).trim();
  return s === "" ? null : s;
};
/**
 * Champs que le livreur ne saisit PLUS (ils restent en base, affichés au
 * super-admin). Tant qu'un formulaire ne les envoie pas, on ne les écrit pas :
 * les inclure inconditionnellement les remettrait à `null`. Le jour où un écran
 * les repose, il suffit qu'il les soumette.
 */
function legacyProfileKeys(formData: FormData): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const key of [
    "national_id_number",
    "id_card_number",
    "address",
  ] as const) {
    if (formData.has(key)) out[key] = selfTxt(formData.get(key));
  }
  if (formData.has("vehicle_year")) {
    out.vehicle_year = selfInt(formData.get("vehicle_year"));
  }
  return out;
}

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
      vehicle_plate: selfTxt(formData.get("vehicle_plate")),
      wilaya: selfTxt(formData.get("wilaya")),
      // Ces quatre-là ne sont plus demandés au livreur mais restent visibles du
      // super-admin : un `update` inconditionnel les remettrait à `null`.
      ...legacyProfileKeys(formData),
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
  const allowed = [
    "cni",
    "permis",
    "carte_grise",
    "assurance",
    "passeport",
    "autre",
  ];
  if (!docType || !allowed.includes(docType))
    return { error: "Type de pièce invalide." };

  // Signature binaire vérifiée serveur ; extension dérivée du contenu réel.
  const v = await validateUploadedFile(formData.get("file"), {
    kind: "image-pdf",
    maxBytes: SELF_MAX_SCAN,
  });
  if (!v.ok) return { error: v.error };

  const supabase = await createClient();
  const path = `${driver.id}/${globalThis.crypto.randomUUID()}.${v.ext}`;
  const { error: upErr } = await supabase.storage
    .from(SELF_DOCS_BUCKET)
    .upload(path, v.bytes, { contentType: v.mime, upsert: false });
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
  // Le super-admin applique ce payload tel quel (`update(p)`) : une clé absente
  // est donc PRÉSERVÉE en base, une clé à `null` l'écrase.
  const payload = {
    vehicle_type: selfTxt(formData.get("vehicle_type")),
    vehicle_brand: selfTxt(formData.get("vehicle_brand")),
    vehicle_model: selfTxt(formData.get("vehicle_model")),
    vehicle_color: selfTxt(formData.get("vehicle_color")),
    vehicle_plate: selfTxt(formData.get("vehicle_plate")),
    wilaya: selfTxt(formData.get("wilaya")),
    ...legacyProfileKeys(formData),
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
