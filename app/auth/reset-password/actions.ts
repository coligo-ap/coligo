"use server";

import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { APP_CONFIG } from "@/lib/config/app-config";

export type ResetState = { error?: string; ok?: boolean; message?: string };

const emailSchema = z.object({
  email: z.string().email("Email invalide"),
  audience: z.enum(["merchant", "customer"]).default("customer"),
});

const passwordSchema = z
  .object({
    password: z.string().min(8, "Au moins 8 caractères"),
    confirm: z.string(),
  })
  .refine((v) => v.password === v.confirm, {
    message: "Les mots de passe ne correspondent pas",
    path: ["confirm"],
  });

/**
 * Envoie un email de réinitialisation. Le lien renvoie vers
 * `/auth/reset-password?next=...` où l'utilisateur saisit un nouveau mdp.
 *
 * On NE révèle JAMAIS si l'email existe ou pas (anti enum) — on répond
 * toujours "Si un compte existe, un email a été envoyé".
 */
export async function sendPasswordResetEmail(
  _prev: ResetState,
  formData: FormData
): Promise<ResetState> {
  const parsed = emailSchema.safeParse({
    email: formData.get("email"),
    audience: formData.get("audience") ?? "customer",
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Email invalide" };
  }

  const supabase = await createClient();
  // URL d'origine — depuis l'env. Fallback raisonnable en dev.
  const origin = (
    process.env.NEXT_PUBLIC_APP_URL ?? "http://localhost:3000"
  ).replace(/\/+$/, "");
  // Le lien email mène à `/auth/reset-password` qui gère l'échange du token
  // de recovery et présente le formulaire de nouveau mot de passe.
  const redirectTo = `${origin}/auth/reset-password?audience=${parsed.data.audience}`;

  const { error } = await supabase.auth.resetPasswordForEmail(
    parsed.data.email,
    { redirectTo }
  );

  // Silence côté UX : succès apparent même si erreur (anti-enum), MAIS on log
  // les vraies erreurs serveur pour qu'on les voie dans Vercel logs.
  if (error && process.env.NODE_ENV !== "production") {
    console.warn("[reset-password] non-prod error:", error);
  }
  return {
    ok: true,
    message: `Si un compte ${APP_CONFIG.name} existe pour ${parsed.data.email}, un email de réinitialisation vient d'être envoyé. Vérifie ta boîte (et les spams).`,
  };
}

/**
 * Définit un nouveau mot de passe pour l'utilisateur actuellement
 * authentifié via le lien de recovery. Supabase auth installe une session
 * temporaire dès que le user clique le lien → on peut appeler updateUser.
 */
export async function updatePasswordAfterReset(
  _prev: ResetState,
  formData: FormData
): Promise<ResetState> {
  const parsed = passwordSchema.safeParse({
    password: formData.get("password"),
    confirm: formData.get("confirm"),
  });
  if (!parsed.success) {
    return { error: parsed.error.issues[0]?.message ?? "Données invalides" };
  }
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    return {
      error: "Lien de récupération invalide ou expiré. Refais une demande.",
    };
  }
  const { error } = await supabase.auth.updateUser({
    password: parsed.data.password,
  });
  if (error) {
    return { error: `Échec : ${error.message}` };
  }
  return { ok: true, message: "Mot de passe mis à jour ✓" };
}
