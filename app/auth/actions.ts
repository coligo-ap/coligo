"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { provisionSocialUser, safeNext } from "@/lib/auth/social-provision";

export type NativeGoogleState = { error?: string };

/**
 * Connexion Google depuis l'APK, à partir de l'`id_token` rendu par le Sign-In
 * Google NATIF (Credential Manager). Aucun navigateur n'est ouvert.
 *
 * Pourquoi ici, et pas dans la WebView : `signInWithIdToken` appelé côté serveur
 * pose les cookies de session en `httpOnly` (cf. `lib/supabase/session-config.ts`),
 * exactement comme la connexion par mot de passe. Le faire côté client les
 * rendrait lisibles par JavaScript, sans aucun bénéfice.
 *
 * Le `nonce` protège du rejeu : le natif a passé à Google le SHA-256 du nonce
 * brut, Google l'a scellé dans le jeton, et Supabase re-hache celui qu'on lui
 * donne ici pour le comparer au claim. Un jeton volé sans son nonce brut est
 * donc inutilisable.
 */
export async function signInWithGoogleNative(input: {
  idToken: string;
  /** Nonce BRUT (Supabase le hache lui-même pour le comparer au jeton). */
  nonce: string;
  next?: string;
}): Promise<NativeGoogleState> {
  const idToken = input.idToken?.trim();
  if (!idToken) return { error: "Jeton Google manquant." };

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithIdToken({
    provider: "google",
    token: idToken,
    nonce: input.nonce || undefined,
  });
  if (error) {
    // Le message de Supabase est technique (audience, nonce, expiration) : on
    // n'expose que le nécessaire, et le détail part dans les logs serveur.
    console.error("signInWithIdToken (google, natif) :", error.message);
    return { error: "La connexion avec Google a échoué. Réessaie." };
  }

  const to = await provisionSocialUser(supabase, safeNext(input.next));
  redirect(to);
}
