// =============================================================================
// BOUTIQUES D'APPLICATIONS — source unique (identifiants, liens, détection).
//
// Module NEUTRE (ni "use client" ni "use server") : les mêmes fonctions servent
// au SERVEUR (redirection immédiate d'après l'en-tête User-Agent, avant même
// le premier pixel) et au NAVIGATEUR (correction des cas que l'en-tête ne dit
// pas — voir `detectPlatformClient`).
//
// Un seul point d'entrée public : `/telecharger`. Tous les boutons du site y
// pointent, et c'est LUI qui décide de la boutique. Avantage : le jour où un
// lien de campagne, un QR imprimé ou un SMS circule, il reste valable quel que
// soit l'appareil de la personne qui l'ouvre.
// =============================================================================

/** iOS — identifiant numérique App Store (fiche publiée, DZ incluse). */
export const APP_STORE_ID = "6790816270";
/** Android — nom de paquet du flavor CLIENT publié sur Google Play. */
export const PLAY_PACKAGE = "app.coligo.client";

export const APP_STORE_URL = `https://apps.apple.com/app/id${APP_STORE_ID}`;
export const PLAY_URL = `https://play.google.com/store/apps/details?id=${PLAY_PACKAGE}`;

export type DevicePlatform = "ios" | "android" | "desktop";

/**
 * Plateforme déduite de l'en-tête `User-Agent` (SERVEUR).
 *
 * Volontairement tolérante : navigateurs alternatifs (Firefox, Samsung
 * Internet, Opera, UC), navigateurs INTÉGRÉS aux applications (Facebook,
 * Instagram, TikTok, Messenger, WhatsApp) — très fréquents quand un lien est
 * partagé — et tablettes sont couverts, car tous conservent « iPhone / iPad /
 * Android » dans leur chaîne.
 *
 * Limite connue et assumée : depuis iPadOS 13, Safari sur iPad annonce un
 * User-Agent de Mac. Impossible à distinguer côté serveur — c'est le
 * navigateur qui rattrape (`detectPlatformClient`).
 */
export function detectPlatformFromUA(
  ua: string | null | undefined
): DevicePlatform {
  const s = (ua ?? "").toLowerCase();
  if (!s) return "desktop";
  // Android d'abord : certains User-Agents Android contiennent « like Mac ».
  if (s.includes("android")) return "android";
  if (/iphone|ipad|ipod/.test(s)) return "ios";
  // iOS force tous les navigateurs à utiliser WebKit : Chrome/Firefox y sont
  // « crios »/« fxios » et n'écrivent pas toujours « iPhone ».
  if (/crios|fxios|opios|edgios/.test(s)) return "ios";
  return "desktop";
}

/**
 * Plateforme déduite DANS LE NAVIGATEUR — rattrape ce que l'en-tête ne dit pas.
 *
 * Deux cas réels :
 *   - iPad moderne : User-Agent de Mac, mais un vrai Mac n'a pas d'écran
 *     tactile → `maxTouchPoints > 1` le trahit ;
 *   - `navigator.userAgentData.platform` (Chromium) est plus fiable que la
 *     chaîne quand il est disponible.
 */
export function detectPlatformClient(): DevicePlatform {
  if (typeof navigator === "undefined") return "desktop";
  const uaData = (
    navigator as Navigator & { userAgentData?: { platform?: string } }
  ).userAgentData;
  const hinted = (uaData?.platform ?? "").toLowerCase();
  if (hinted.includes("android")) return "android";

  const byUA = detectPlatformFromUA(navigator.userAgent);
  if (byUA !== "desktop") return byUA;

  // iPad/iPadOS déguisé en Mac : tactile + plateforme Apple.
  const touch = navigator.maxTouchPoints ?? 0;
  if (touch > 1 && /macintosh|mac os x/i.test(navigator.userAgent))
    return "ios";
  return "desktop";
}

/** Lien de la boutique correspondante (`null` sur ordinateur : on montre les deux). */
export function storeUrlFor(platform: DevicePlatform): string | null {
  if (platform === "ios") return APP_STORE_URL;
  if (platform === "android") return PLAY_URL;
  return null;
}

/**
 * Normalise un paramètre `?p=` (lien forcé : « voir sur l'App Store » depuis un
 * ordinateur, campagne ciblée…). Toute autre valeur est ignorée.
 */
export function forcedPlatform(
  value: string | null | undefined
): DevicePlatform | null {
  if (value === "ios" || value === "android") return value;
  return null;
}
