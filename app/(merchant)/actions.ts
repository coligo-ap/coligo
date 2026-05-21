"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export type AuthState = {
  error?: string;
  success?: string;
};

/**
 * Connexion email + password.
 */
export async function login(
  _prevState: AuthState,
  formData: FormData
): Promise<AuthState> {
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");

  if (!email || !password) {
    return { error: "Email et mot de passe requis" };
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithPassword({ email, password });

  if (error) {
    if (error.message.includes("Invalid login credentials")) {
      return { error: "Email ou mot de passe incorrect" };
    }
    if (error.message.includes("Email not confirmed")) {
      return { error: "Veuillez confirmer votre email avant de vous connecter" };
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
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const password = String(formData.get("password") ?? "");
  const merchantName = String(formData.get("merchantName") ?? "").trim();
  const category = String(formData.get("category") ?? "").trim();
  const wilayaCode = String(formData.get("wilayaCode") ?? "").trim();
  const city = String(formData.get("city") ?? "").trim();

  if (!email || !password || !merchantName) {
    return { error: "Les champs marqués * sont requis" };
  }
  if (password.length < 8) {
    return { error: "Le mot de passe doit contenir au moins 8 caractères" };
  }
  if (!email.includes("@")) {
    return { error: "Email invalide" };
  }

  const supabase = await createClient();

  const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
    email,
    password,
    options: {
      data: { merchant_name: merchantName },
    },
  });

  console.log("[signup] supabase response:", {
    hasUser: !!signUpData?.user,
    userId: signUpData?.user?.id,
    identities: signUpData?.user?.identities?.length,
    hasSession: !!signUpData?.session,
    error: signUpError,
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
    return { error: "Erreur lors de la création du compte (pas d'utilisateur retourné)" };
  }

  if (signUpData.user.identities?.length === 0) {
    return { error: "Un compte existe déjà avec cet email" };
  }

  const { error: merchantError } = await supabase.from("merchants").insert({
    user_id: signUpData.user.id,
    name: merchantName,
    category: category || null,
    wilaya_code: wilayaCode || null,
    city: city || null,
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
