"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { normalizePhone, phoneToEmail } from "@/lib/auth/driver";
import { hashReferralCode } from "@/lib/drivers/referral-code";
import { notifyMerchantNewDriverRequest } from "@/lib/fcm/triggers";

export type DriverAuthState = { error?: string; ok?: boolean };

const signupSchema = z.object({
  full_name: z.string().min(2, "Nom trop court").max(80),
  phone: z.string().min(6, "Téléphone invalide"),
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
    full_name: formData.get("full_name"),
    phone: formData.get("phone"),
    password: formData.get("password"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Données invalides" };
  }

  const supabase = await createClient();
  const phone = normalizePhone(parsed.data.phone);
  const email = phoneToEmail(parsed.data.phone);

  const { data: signup, error } = await supabase.auth.signUp({
    email,
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
    full_name: parsed.data.full_name,
    phone,
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
  if (row.ok) revalidatePath("/driver");
  return { ok: row.ok, reason: row.reason ?? undefined };
}
