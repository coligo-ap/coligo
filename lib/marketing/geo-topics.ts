// =============================================================================
// Topics FCM MARKETING par zone (wilaya) — contrat partagé client ⇄ serveur.
//
// But : découpler le MARKETING (promos de commerçants proches) des
// notifications PERSONNELLES. Le personnel est adressé par `token`/`user_id`
// (coupé à la déconnexion). Le marketing, lui, est adressé à un TOPIC de zone
// auquel l'appareil s'abonne INDÉPENDAMMENT de la session → un utilisateur
// déconnecté continue de recevoir les promos de sa wilaya, comme les grandes
// apps. Aucune donnée personnelle : le topic ne dépend que de la zone.
// =============================================================================

/** Nom de topic canonique pour une wilaya. Normalisé sur 2 chiffres pour que
 *  "6" et "06" désignent le MÊME topic (abonnement et envoi cohérents). */
export function wilayaTopic(code: string): string {
  return `promo_wilaya_${String(Number(code)).padStart(2, "0")}`;
}

/** Wilaya DZ valide = code numérique 1..58 (accepte "6" ou "06"). */
export function isValidWilaya(code: string | null | undefined): code is string {
  if (!code) return false;
  const n = Number(code);
  return Number.isInteger(n) && n >= 1 && n <= 58;
}
