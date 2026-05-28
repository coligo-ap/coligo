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
 * Bascule « Fermer / Ouvrir » la réception de commandes du commerçant connecté.
 * Quand `paused` = true, le checkout refuse toute nouvelle commande.
 */
export async function setOrdersPaused(
  paused: boolean
): Promise<{ ok: boolean; paused: boolean; error?: string }> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return { ok: false, paused, error: "Session expirée." };

  const { error } = await supabase
    .from("merchants")
    .update({ orders_paused: paused })
    .eq("user_id", user.id);
  if (error) return { ok: false, paused: !paused, error: error.message };

  revalidatePath("/", "layout");
  return { ok: true, paused };
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
    category: formData.get("category"),
    wilayaCode: formData.get("wilayaCode"),
    city: formData.get("city"),
  });

  if (!parsed.success) {
    return { error: firstZodError(parsed.error) };
  }

  const { email, password, merchantName, category, wilayaCode, city } =
    parsed.data;

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
