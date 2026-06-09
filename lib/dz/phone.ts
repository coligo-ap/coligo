/**
 * Validation / normalisation des numéros de téléphone ALGÉRIENS.
 *
 * Mobile valide : 10 chiffres, commence par 0 puis 5/6/7 (ex. 06 12 34 56 78).
 * On accepte aussi les formes internationales (+213, 00213, 213) et la forme
 * locale sans 0 initial (9 chiffres commençant par 5/6/7) → normalisées en
 * `0XXXXXXXXX`. Tout le reste est invalide.
 */
export function normalizeDzPhone(
  raw: string | null | undefined
): string | null {
  let d = (raw ?? "").replace(/\D/g, "");
  if (d.startsWith("00213")) d = d.slice(5);
  else if (d.startsWith("213")) d = d.slice(3);
  // Forme locale sans 0 (9 chiffres) → on ajoute le 0.
  if (d.length === 9 && /^[567]/.test(d)) d = "0" + d;
  return /^0[567]\d{8}$/.test(d) ? d : null;
}

/** `true` si le numéro est un mobile algérien valide. */
export function isValidDzPhone(raw: string | null | undefined): boolean {
  return normalizeDzPhone(raw) !== null;
}

/** Message d'erreur standard (réutilisable côté formulaires/actions). */
export const DZ_PHONE_ERROR =
  "Numéro de téléphone algérien invalide. Format attendu : 0X XX XX XX XX (mobile 05/06/07).";
