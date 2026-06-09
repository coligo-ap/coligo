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

// ---------------------------------------------------------------------------
// Indicatifs pays (sélecteur du champ téléphone) — l'ALGÉRIE est par défaut.
// ---------------------------------------------------------------------------
export type CountryCode = { dial: string; flag: string; name: string };
export const COUNTRY_CODES: CountryCode[] = [
  { dial: "+213", flag: "🇩🇿", name: "Algérie" },
  { dial: "+216", flag: "🇹🇳", name: "Tunisie" },
  { dial: "+212", flag: "🇲🇦", name: "Maroc" },
  { dial: "+33", flag: "🇫🇷", name: "France" },
  { dial: "+34", flag: "🇪🇸", name: "Espagne" },
  { dial: "+39", flag: "🇮🇹", name: "Italie" },
  { dial: "+32", flag: "🇧🇪", name: "Belgique" },
  { dial: "+49", flag: "🇩🇪", name: "Allemagne" },
  { dial: "+44", flag: "🇬🇧", name: "Royaume-Uni" },
  { dial: "+1", flag: "🇺🇸", name: "USA / Canada" },
  { dial: "+90", flag: "🇹🇷", name: "Turquie" },
  { dial: "+971", flag: "🇦🇪", name: "Émirats" },
  { dial: "+966", flag: "🇸🇦", name: "Arabie S." },
];
export const DEFAULT_DIAL = "+213";

/**
 * Compose un numéro à partir d'un indicatif + numéro national saisi.
 *  - Algérie (+213) → renvoie la forme locale `0XXXXXXXXX` (mobile validé).
 *  - Autres pays → E.164 `+CC<national>` (6 à 13 chiffres) ; null si invalide.
 */
export function composePhone(
  dial: string,
  national: string | null | undefined
): string | null {
  if (dial === "+213") return normalizeDzPhone(national);
  const n = (national ?? "").replace(/\D/g, "").replace(/^0+/, "");
  if (n.length >= 6 && n.length <= 13) return dial + n;
  return null;
}

/**
 * Numéro de CONTACT valide : un mobile algérien OU un numéro international
 * E.164 (`+...`). Utilisé pour le gate « téléphone obligatoire » + checkout.
 */
export function isValidContactPhone(raw: string | null | undefined): boolean {
  if (isValidDzPhone(raw)) return true;
  const s = (raw ?? "").replace(/[^\d+]/g, "");
  return /^\+\d{8,15}$/.test(s);
}

/** Normalise un numéro de contact pour stockage (DZ local ou E.164). */
export function normalizeContactPhone(
  raw: string | null | undefined
): string | null {
  const dz = normalizeDzPhone(raw);
  if (dz) return dz;
  const s = (raw ?? "").replace(/[^\d+]/g, "");
  return /^\+\d{8,15}$/.test(s) ? s : null;
}
