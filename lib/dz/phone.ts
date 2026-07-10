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
//
// Liste VOLONTAIREMENT COURTE : l'Algérie, plus les cinq pays d'où viennent nos
// utilisateurs de la diaspora. Ajouter un pays ici l'ouvre partout, puisque
// `PhoneField` est le seul champ téléphone de l'application.
// ---------------------------------------------------------------------------
export type CountryCode = { dial: string; flag: string; name: string };
export const COUNTRY_CODES: CountryCode[] = [
  { dial: "+213", flag: "🇩🇿", name: "Algérie" },
  { dial: "+33", flag: "🇫🇷", name: "France" },
  { dial: "+34", flag: "🇪🇸", name: "Espagne" },
  { dial: "+39", flag: "🇮🇹", name: "Italie" },
  { dial: "+32", flag: "🇧🇪", name: "Belgique" },
  { dial: "+31", flag: "🇳🇱", name: "Pays-Bas" },
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

/**
 * Inverse de `composePhone` : sépare une valeur stockée en (indicatif, national)
 * pour ré-alimenter le sélecteur du champ.
 *
 * Un indicatif inconnu (pays retiré de `COUNTRY_CODES`) n'est PAS deviné : on
 * retombe sur l'Algérie et on laisse la valeur brute dans le champ national, où
 * elle sera signalée invalide. Mieux vaut une erreur visible qu'un numéro
 * silencieusement réattribué au mauvais pays.
 */
export function splitPhone(raw: string | null | undefined): {
  dial: string;
  national: string;
} {
  const value = (raw ?? "").trim();
  if (!value) return { dial: DEFAULT_DIAL, national: "" };

  if (value.startsWith("+")) {
    // Indicatif le plus long d'abord : +3 ne doit jamais gagner contre +33.
    const match = [...COUNTRY_CODES]
      .sort((a, b) => b.dial.length - a.dial.length)
      .find((c) => value.startsWith(c.dial));
    if (match) {
      return { dial: match.dial, national: value.slice(match.dial.length) };
    }
    return { dial: DEFAULT_DIAL, national: value };
  }

  // Forme locale algérienne (`0XXXXXXXXX`) ou saisie libre.
  return { dial: DEFAULT_DIAL, national: value };
}

/**
 * Groupe les chiffres pour la lecture pendant la frappe. L'Algérie se lit par
 * paires (`06 12 34 56 78`) ; ailleurs on ne devine pas le découpage national,
 * on se contente d'espacer par blocs de trois.
 */
export function formatNational(dial: string, national: string): string {
  const digits = national.replace(/\D/g, "");
  if (!digits) return "";
  const groups =
    dial === "+213"
      ? digits.replace(/(\d{2})(?=\d)/g, "$1 ")
      : digits.replace(/(\d{3})(?=\d)/g, "$1 ");
  return groups.trimEnd();
}

/** Message d'erreur adapté au pays choisi, affiché SOUS le champ. */
export function phoneErrorFor(dial: string): string {
  return dial === "+213"
    ? DZ_PHONE_ERROR
    : "Numéro invalide pour l'indicatif sélectionné.";
}
