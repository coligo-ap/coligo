/**
 * Identité téléphonique des comptes qui n'ont pas d'email : livreur, chauffeur,
 * Agent Coligo Pay. Supabase Auth exige un email, on le synthétise à partir du
 * numéro — d'où un domaine réservé par population (l'isolation des rôles dans
 * `lib/supabase/middleware.ts` repose dessus).
 *
 * SOURCE UNIQUE de cette dérivation. Elle vivait auparavant en trois copies
 * (`lib/auth/driver.ts`, `chauffeur.ts`, `partner.ts`), chacune se contentant de
 * `raw.replace(/\D/g, "")`. Conséquence : le même livreur saisissant
 * « 0603044620 » puis « +213 603044620 » obtenait deux emails synthétiques
 * distincts, donc DEUX COMPTES — et le second échouait plus tard sur un numéro
 * déjà pris. On passe désormais par la forme canonique de `composePhone()`
 * (`0XXXXXXXXX` en Algérie, `+CC…` ailleurs), qui est aussi celle stockée en
 * base : les comptes déjà créés restent donc joignables à l'identique.
 */

import { normalizeContactPhone } from "@/lib/dz/phone";

export const DRIVER_DOMAIN = "drivers.coligo.local";
export const CHAUFFEUR_DOMAIN = "chauffeurs.coligo.local";
export const PARTNER_DOMAIN = "partners.coligo.local";

/**
 * Forme canonique à STOCKER (colonnes `drivers.phone`, `chauffeurs.phone`…).
 * `null` si le numéro n'est pas un mobile algérien ni un E.164 plausible.
 */
export function canonicalPhone(raw: string | null | undefined): string | null {
  return normalizeContactPhone(raw);
}

/**
 * Email synthétique pour Supabase Auth. `null` si le numéro est invalide — les
 * appelants renvoient alors une erreur sous le champ plutôt que de créer un
 * compte sur une valeur ambiguë.
 */
export function phoneToAuthEmail(
  raw: string | null | undefined,
  domain: string
): string | null {
  const canonical = canonicalPhone(raw);
  if (!canonical) return null;
  // Le « + » de l'E.164 n'est pas un caractère d'email valide ; les chiffres
  // seuls suffisent, l'indicatif reste en tête donc l'adresse reste unique.
  return `${canonical.replace(/\D/g, "")}@${domain}`;
}
