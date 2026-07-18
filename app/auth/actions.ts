"use server";

import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import {
  provisionSocialUser,
  safeNext,
  type SocialIntent,
} from "@/lib/auth/social-provision";

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
  /** Portail d'origine — "merchant" cible l'espace commerçant (cf. provision). */
  intent?: SocialIntent;
}): Promise<NativeGoogleState> {
  const idToken = input.idToken?.trim();
  if (!idToken) return { error: "Jeton Google manquant." };

  // Le SDK Google iOS (via le plugin) n'embarque pas toujours le nonce dans
  // le jeton (Android/Credential Manager le fait). Supabase exige la
  // COHÉRENCE : nonce fourni ⇔ claim présent. On décode donc le payload
  // (sans vérification — Supabase vérifie la signature) et on ne transmet le
  // nonce QUE si le jeton en porte un.
  let tokenHasNonce = false;
  try {
    const payload = JSON.parse(
      Buffer.from(idToken.split(".")[1], "base64url").toString("utf8")
    ) as { nonce?: string };
    tokenHasNonce = typeof payload.nonce === "string" && payload.nonce !== "";
  } catch {
    /* payload illisible : Supabase tranchera */
  }

  const supabase = await createClient();
  const { error } = await supabase.auth.signInWithIdToken({
    provider: "google",
    token: idToken,
    nonce: tokenHasNonce ? input.nonce || undefined : undefined,
  });
  if (error) {
    console.error("signInWithIdToken (google, natif) :", error.message);
    // Cause technique COURTE entre crochets : indispensable pour diagnostiquer
    // à distance sur un téléphone de testeur (pas de console accessible).
    return {
      error: `La connexion avec Google a échoué. Réessaie. [${error.message.slice(0, 90)}]`,
    };
  }

  const to = await provisionSocialUser(
    supabase,
    safeNext(input.next),
    input.intent === "merchant" ? "merchant" : "customer"
  );
  redirect(to);
}
