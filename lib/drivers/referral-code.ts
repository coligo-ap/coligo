/**
 * Code de référence livreur — génération + hachage.
 *
 * Format : <SLUG_UPPERCASE_MAX_12>-<6_RANDOM_NO_AMBIG>
 *   ex: BOULANGERIE-K4Q7X9
 *
 * - Le code est lisible (préfixe = nom de boutique) → facile à dicter
 *   au téléphone à un livreur.
 * - 6 chars d'entropie = ~32^6 ≈ 1 milliard de combinaisons. Suffisant pour
 *   bloquer l'énumération en pratique (rate-limit côté endpoint + un
 *   commerçant ne crée qu'un code à la fois).
 * - Caractères évités : 0/O, 1/I, L/l (lisibilité au téléphone).
 *
 * Le hash stocké = SHA-256(code + pepper). Le pepper est facultatif
 * (env `REFERRAL_CODE_PEPPER`) ; sans pepper, un attaquant qui obtient
 * la DB ne peut pas remonter au code en clair sans brute-force du suffixe
 * (~ 1 milliard tests par commerçant). Avec pepper côté serveur, il faut
 * aussi le voler.
 */

import { createHash, randomBytes } from "node:crypto";

const ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789"; // pas de 0/O, 1/I, L

function randomSuffix(len: number): string {
  // randomBytes (CSPRNG) — pas Math.random qui est prédictible.
  const buf = randomBytes(len);
  let out = "";
  for (let i = 0; i < len; i++) {
    out += ALPHABET[buf[i] % ALPHABET.length];
  }
  return out;
}

/**
 * Slug → préfixe propre, MAJ, sans tirets en bord, max 12 chars.
 * Fallback `SHOP` si le slug n'a aucun char alpha utilisable.
 */
function slugPrefix(slug: string): string {
  const cleaned = slug
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^A-Za-z0-9]/g, "")
    .toUpperCase();
  if (cleaned.length === 0) return "SHOP";
  return cleaned.slice(0, 12);
}

/** Génère un nouveau code en clair (à montrer UNE FOIS au commerçant). */
export function generateReferralCode(slug: string): string {
  return `${slugPrefix(slug)}-${randomSuffix(6)}`;
}

/**
 * Hash déterministe du code (sha256 hex). On peut chercher par hash
 * dans `merchant_referral_codes.code_hash`.
 */
export function hashReferralCode(code: string): string {
  const pepper = process.env.REFERRAL_CODE_PEPPER ?? "";
  return createHash("sha256")
    .update(code.trim().toUpperCase() + pepper)
    .digest("hex");
}

/**
 * Vérifie un code soumis contre un hash stocké (constant-time côté
 * sha256 sur chaîne courte — le risque timing est négligeable ici car
 * on compare des chaînes hex de longueur fixe ; on reste sur === pour
 * la lisibilité ; pour upgrade, utiliser timingSafeEqual).
 */
export function verifyReferralCode(code: string, storedHash: string): boolean {
  return hashReferralCode(code) === storedHash;
}
