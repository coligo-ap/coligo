"use client";

import { isNative, getNativePlatform } from "./context";

/**
 * Sign-In Google NATIF (Android : Credential Manager ; iOS : Google Sign-In SDK).
 *
 * POURQUOI DU NATIF, ET PAS L'OAUTH NAVIGATEUR
 * --------------------------------------------
 * L'app est un flavor Capacitor : une WebView qui charge `coligo.app`. Elle a
 * son PROPRE magasin de cookies, isolé de Chrome. Or Google refuse l'OAuth dans
 * une WebView embarquée (`disallowed_useragent`) : la connexion se ferait donc
 * dans le navigateur système, qui poserait la session… dans SES cookies. L'app
 * resterait déconnectée. (Un TWA n'avait pas ce problème : un TWA EST Chrome.)
 *
 * Le natif court-circuite tout ça : Google rend directement un `id_token`, qu'on
 * échange contre une session Supabase côté serveur. Zéro navigateur, zéro deep
 * link.
 *
 * NONCE — protection contre le rejeu
 * ----------------------------------
 * On tire un nonce aléatoire, on donne son SHA-256 à Google (qui le scelle dans
 * le jeton) et le nonce BRUT à Supabase, qui re-hache pour comparer. Un jeton
 * intercepté est donc inutilisable sans le nonce brut, qui n'a jamais transité
 * par Google.
 */

/** Client OAuth de type WEB, dans Google Cloud. C'est l'audience du jeton. */
const WEB_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID;
/** Client OAuth de type iOS (bundle app.coligo.client) — REQUIS sur iPhone :
 *  le SDK Google natif iOS refuse de s'initialiser sans lui (l'Android, via
 *  Credential Manager, se contente du client web). */
const IOS_CLIENT_ID = process.env.NEXT_PUBLIC_GOOGLE_IOS_CLIENT_ID;

/** Vrai si l'on tourne dans l'app ET que le client Google requis existe. */
export function canUseNativeGoogle(): boolean {
  if (!isNative() || !WEB_CLIENT_ID) return false;
  // iOS exige SON client OAuth ; sans lui on ne tente pas (et surtout on ne
  // bascule JAMAIS sur l'OAuth web : dans la WebView, accounts.google.com
  // est un hôte externe → l'app éjecterait vers Safari et la session
  // atterrirait dans le navigateur, pas dans l'app).
  if (getNativePlatform() === "ios") return Boolean(IOS_CLIENT_ID);
  return true;
}

/** Nonce brut : 32 octets aléatoires, en base64url. */
function randomNonce(): string {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return btoa(String.fromCharCode(...bytes))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

/** SHA-256 en hexadécimal — la forme que Google attend et scelle dans le jeton. */
async function sha256Hex(value: string): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(value)
  );
  return [...new Uint8Array(digest)]
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");
}

export class NativeGoogleError extends Error {
  /** `true` quand l'utilisateur a simplement fermé la feuille Google. */
  readonly cancelled: boolean;
  constructor(message: string, cancelled = false) {
    super(message);
    this.name = "NativeGoogleError";
    this.cancelled = cancelled;
  }
}

/**
 * Ouvre la feuille Google native et renvoie de quoi ouvrir la session côté
 * serveur. Le plugin n'est chargé qu'ici, en import dynamique : le bundle web ne
 * l'embarque pas.
 */
export async function nativeGoogleIdToken(): Promise<{
  idToken: string;
  nonce: string;
}> {
  if (!WEB_CLIENT_ID) {
    throw new NativeGoogleError(
      "NEXT_PUBLIC_GOOGLE_WEB_CLIENT_ID n'est pas défini."
    );
  }

  const { SocialLogin } = await import("@capgo/capacitor-social-login");

  const nonce = randomNonce();
  const hashedNonce = await sha256Hex(nonce);

  await SocialLogin.initialize({
    google: {
      webClientId: WEB_CLIENT_ID,
      // iOS : le SDK natif Google veut le client de SA plateforme (le jeton
      // reste émis pour l'audience web grâce à webClientId).
      ...(getNativePlatform() === "ios" && IOS_CLIENT_ID
        ? { iOSClientId: IOS_CLIENT_ID }
        : {}),
    },
  });

  // TOUJOURS montrer le SÉLECTEUR de comptes : sans ce logout préalable, le
  // SDK réutilise silencieusement la dernière session Google — un client qui
  // veut changer de compte (ou qui vient de supprimer le sien) se retrouvait
  // reconnecté d'office au même compte, sans choix (bug vécu iOS). Un compte
  // unique = un tap de plus, le prix du contrôle. Best-effort : jamais bloquant.
  try {
    await SocialLogin.logout({ provider: "google" });
  } catch {
    /* pas de session à fermer — normal au premier passage */
  }

  let result;
  try {
    result = await SocialLogin.login({
      provider: "google",
      options: { nonce: hashedNonce },
    });
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    // Credential Manager remonte une annulation utilisateur comme une erreur.
    const cancelled = /cancel|dismiss|USER_CANCELED/i.test(message);
    throw new NativeGoogleError(message, cancelled);
  }

  const idToken = (result.result as { idToken?: string | null } | undefined)
    ?.idToken;
  if (!idToken) {
    throw new NativeGoogleError("Google n'a pas renvoyé de jeton d'identité.");
  }

  return { idToken, nonce };
}
