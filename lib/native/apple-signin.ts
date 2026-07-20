"use client";

import { isNative, getNativePlatform } from "./context";

/**
 * Sign in with Apple NATIF (iOS) — pendant de `lib/native/google-signin.ts`.
 *
 * POURQUOI DU NATIF : l'app est une WebView Capacitor à cookies isolés. Le
 * natif (ASAuthorization) rend un `identityToken` (JWT), échangé côté serveur
 * via `signInWithIdToken`, exactement comme Google. Zéro navigateur.
 *
 * POURQUOI CE BOUTON EXISTE : l'App Store (règle 4.8) EXIGE « Sign in with
 * Apple » dès qu'un autre login tiers (ici Google) est proposé. Il doit donc
 * apparaître partout où Google apparaît, sur iOS.
 *
 * iOS uniquement en natif : le web (PWA/navigateur) passe par l'OAuth Apple
 * classique (`signInWithOAuth({ provider: "apple" })`), et Android n'a pas
 * besoin d'Apple (Google Play ne l'impose pas) → bouton masqué là-bas.
 */

// Service ID « web auth » déclaré chez Apple + Supabase (app.coligo.client.auth).
// Sert d'identifiant client au plugin ; sur iOS natif, ASAuthorization utilise
// surtout l'entitlement `com.apple.developer.applesignin` du binaire.
const APPLE_SERVICE_ID =
  process.env.NEXT_PUBLIC_APPLE_SERVICE_ID ?? "app.coligo.client.auth";

/** Vrai si le Sign in with Apple NATIF est disponible (iOS dans l'app). */
export function canUseNativeApple(): boolean {
  return isNative() && getNativePlatform() === "ios";
}

export class NativeAppleError extends Error {
  /** `true` quand l'utilisateur a simplement fermé la feuille Apple. */
  readonly cancelled: boolean;
  constructor(message: string, cancelled = false) {
    super(message);
    this.name = "NativeAppleError";
    this.cancelled = cancelled;
  }
}

/**
 * Ouvre la feuille Apple native et renvoie l'identityToken. Le plugin n'est
 * chargé qu'ici (import dynamique) : le bundle web ne l'embarque pas.
 *
 * Pas de nonce volontairement : sans nonce demandé, Apple n'insère pas de claim
 * `nonce` dans le jeton, donc Supabase n'en exige pas → aucun risque de
 * décalage (cause n°1 des échecs Apple). Le jeton reste signé par Apple et sa
 * signature est vérifiée côté serveur.
 */
export async function nativeAppleIdToken(): Promise<{ idToken: string }> {
  const { SocialLogin } = await import("@capgo/capacitor-social-login");
  await SocialLogin.initialize({ apple: { clientId: APPLE_SERVICE_ID } });

  let result;
  try {
    result = await SocialLogin.login({
      provider: "apple",
      options: { scopes: ["email", "name"] },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // ASAuthorization : annulation utilisateur = code 1001 / "canceled".
    const cancelled = /cancel|1001|dismiss/i.test(message);
    throw new NativeAppleError(message, cancelled);
  }

  const idToken = (result.result as { idToken?: string | null } | undefined)
    ?.idToken;
  if (!idToken) {
    throw new NativeAppleError("Apple n'a pas renvoyé de jeton d'identité.");
  }
  return { idToken };
}
