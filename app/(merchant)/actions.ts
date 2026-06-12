"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  loginSchema,
  signupSchema,
  firstZodError,
} from "@/lib/validation/auth";
import { suggestedMinOrderForCategory } from "@/lib/config/payment-limits";

export type AuthState = {
  error?: string;
  success?: string;
};

/**
 * Pause / fermeture de la réception de commandes (commerçant connecté).
 *
 *  - open             → rouvre (annule toute pause).
 *  - pause_30m/1h/2h  → pause temporaire à réouverture automatique.
 *  - close_today      → fermé jusqu'à la fin de la journée (réouverture demain).
 *  - close_indefinite → fermé jusqu'à réouverture manuelle.
 *
 * Cf. `lib/merchant/pause-state.ts` pour la logique partagée avec le checkout.
 * Une fermeture immédiate ne peut couvrir AU PLUS que la journée ; pour fermer
 * plusieurs jours, le commerçant programme une fermeture (`setScheduledClosure`).
 */
export type ShopPauseMode =
  | "open"
  | "pause_30m"
  | "pause_1h"
  | "pause_2h"
  | "close_today"
  | "close_indefinite";

export async function setShopPause(
  mode: ShopPauseMode
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Session expirée." };

  const now = new Date();
  let ordersPaused = true;
  let pausedUntil: string | null = null;

  switch (mode) {
    case "open":
      ordersPaused = false;
      pausedUntil = null;
      break;
    case "close_indefinite":
      pausedUntil = null;
      break;
    case "close_today": {
      const end = new Date(now);
      end.setHours(23, 59, 59, 0);
      pausedUntil = end.toISOString();
      break;
    }
    case "pause_30m":
    case "pause_1h":
    case "pause_2h": {
      const mins = mode === "pause_30m" ? 30 : mode === "pause_1h" ? 60 : 120;
      pausedUntil = new Date(now.getTime() + mins * 60_000).toISOString();
      break;
    }
  }

  const { error } = await supabase
    .from("merchants")
    .update({ orders_paused: ordersPaused, paused_until: pausedUntil })
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Programme (ou annule) une fermeture sur une plage de dates (congés, travaux).
 * `start`/`end` en ISO ; les deux `null` = annulation. Le commerce est fermé
 * tant que `now()` est dans [start, end] (cf. `computePauseState`).
 */
export async function setScheduledClosure(
  start: string | null,
  end: string | null
): Promise<{ ok: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, error: "Session expirée." };

  if (start || end) {
    if (!start || !end) {
      return { ok: false, error: "Indiquez une date de début ET de fin." };
    }
    const s = new Date(start);
    const e = new Date(end);
    if (Number.isNaN(s.getTime()) || Number.isNaN(e.getTime())) {
      return { ok: false, error: "Dates invalides." };
    }
    if (e <= s) {
      return { ok: false, error: "La fin doit être après le début." };
    }
  }

  const { error } = await supabase
    .from("merchants")
    .update({ closure_start: start, closure_end: end })
    .eq("user_id", user.id);
  if (error) return { ok: false, error: error.message };

  revalidatePath("/", "layout");
  return { ok: true };
}

/**
 * Connexion email + password.
 */
export async function login(
  _prevState: AuthState,
  formData: FormData
): Promise<AuthState> {
  const parsed = loginSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
  });

  if (!parsed.success) {
    return { error: firstZodError(parsed.error) };
  }

  const { email, password } = parsed.data;

  // Cloisonnement des métiers : les comptes livreur/chauffeur (emails
  // synthétiques internes) ne se connectent jamais sur l'espace commerçant.
  const emailLc = email.toLowerCase();
  if (
    emailLc.endsWith("@drivers.coligo.local") ||
    emailLc.endsWith("@chauffeurs.coligo.local")
  ) {
    return { error: "Email ou mot de passe incorrect" };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    if (error.message.includes("Invalid login credentials")) {
      return { error: "Email ou mot de passe incorrect" };
    }
    if (error.message.includes("Email not confirmed")) {
      return {
        error: "Veuillez confirmer votre email avant de vous connecter",
      };
    }
    return { error: error.message };
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

/**
 * Inscription d'un nouveau commerçant.
 */
export async function signup(
  _prevState: AuthState,
  formData: FormData
): Promise<AuthState> {
  const parsed = signupSchema.safeParse({
    email: formData.get("email"),
    password: formData.get("password"),
    merchantName: formData.get("merchantName"),
    managerName: formData.get("managerName"),
    latitude: formData.get("latitude"),
    longitude: formData.get("longitude"),
    address: formData.get("address"),
    category: formData.get("category"),
    wilayaCode: formData.get("wilayaCode"),
    city: formData.get("city"),
  });

  if (!parsed.success) {
    return { error: firstZodError(parsed.error) };
  }

  const {
    email,
    password,
    merchantName,
    managerName,
    latitude,
    longitude,
    address,
    category,
    wilayaCode,
    city,
  } = parsed.data;

  // Les domaines internes livreur/chauffeur ne sont pas des emails valides ici.
  if (email.toLowerCase().endsWith(".coligo.local")) {
    return { error: "Adresse email invalide." };
  }

  // Position carte → nombres bornés (obligatoire, choisie sur la carte).
  const lat = Number(latitude);
  const lng = Number(longitude);
  if (
    !Number.isFinite(lat) ||
    !Number.isFinite(lng) ||
    lat < -90 ||
    lat > 90 ||
    lng < -180 ||
    lng > 180
  ) {
    return { error: "Position sur la carte invalide — replacez le repère." };
  }

  const supabase = await createClient();

  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { merchant_name: merchantName },
    },
  });

  if (signUpError) {
    if (signUpError.message.includes("already registered")) {
      return { error: "Un compte existe déjà avec cet email" };
    }
    if (signUpError.message.toLowerCase().includes("rate limit")) {
      return {
        error:
          "Trop de tentatives d'inscription récentes. Patientez ~1h (limite Supabase d'envoi d'emails) ou configurez un SMTP personnalisé.",
      };
    }
    return { error: signUpError.message };
  }

  if (!signUpData.user) {
    return {
      error:
        "Erreur lors de la création du compte (pas d'utilisateur retourné)",
    };
  }

  if (signUpData.user.identities?.length === 0) {
    return { error: "Un compte existe déjà avec cet email" };
  }

  const { error: merchantError } = await supabase.from("merchants").insert({
    user_id: signUpData.user.id,
    name: merchantName,
    manager_name: managerName,
    latitude: lat,
    longitude: lng,
    address,
    category,
    wilaya_code: wilayaCode,
    city,
    // Pré-remplit le minimum de commande selon le panier moyen de la catégorie
    // (étude pouvoir d'achat algérien). Le commerçant peut le monter dans ses
    // réglages ; le plancher Coligo s'applique côté checkout.
    min_order_da: suggestedMinOrderForCategory(category),
  });

  if (merchantError) {
    return {
      error: `Compte créé mais erreur création boutique : ${merchantError.message}`,
    };
  }

  if (!signUpData.session) {
    return {
      success:
        "Compte créé ! Vérifiez votre email pour activer le compte, puis connectez-vous.",
    };
  }

  revalidatePath("/", "layout");
  redirect("/dashboard");
}

/**
 * Déconnexion.
 */
export async function logout() {
  const supabase = await createClient();
  await supabase.auth.signOut();
  revalidatePath("/", "layout");
  redirect("/login");
}
