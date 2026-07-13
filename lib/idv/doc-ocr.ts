// =============================================================================
// IDV — EXTRACTION depuis la zone VISUELLE d'un document (module PUR).
// Sert au PERMIS DE CONDUIRE algérien, qui n'a pas de MRZ : on ne peut pas
// s'appuyer sur des sommes de contrôle, seulement sur du texte imprimé.
//
// Prudence assumée : on n'invente rien. On extrait ce qui est FIABLE (les
// dates, très structurées : jj/mm/aaaa ou jj.mm.aaaa) et on laisse le reste à
// la revue humaine. Une date d'expiration lue est vérifiée exactement comme
// celle d'une MRZ (le document doit être en cours de validité).
// =============================================================================

export type DocOcrFields = {
  /** ISO yyyy-mm-dd — la plus tardive des dates lues (expiration). */
  expiry_date: string | null;
  /** ISO yyyy-mm-dd — la plus ancienne (naissance, en pratique). */
  birth_date: string | null;
  /** Toutes les dates lues, triées (traçabilité pour l'admin). */
  dates: string[];
  /** Numéro de document candidat (suite de 8+ chiffres/lettres). */
  document_number: string | null;
};

const DATE_RE = /\b(\d{2})[\/.\-\s](\d{2})[\/.\-\s](\d{4})\b/g;

/** Une date plausible (bornes larges : 1900 → aujourd'hui + 30 ans). */
function toIso(d: number, m: number, y: number): string | null {
  if (m < 1 || m > 12 || d < 1 || d > 31) return null;
  const maxYear = new Date().getFullYear() + 30;
  if (y < 1900 || y > maxYear) return null;
  const dd = String(d).padStart(2, "0");
  const mm = String(m).padStart(2, "0");
  return `${y}-${mm}-${dd}`;
}

/**
 * Extrait les champs exploitables du texte OCR d'un document sans MRZ.
 * Le texte arrive brut (plusieurs langues, ponctuation, bruit) : tout ce qui
 * n'est pas une structure certaine est ignoré.
 */
export function extractFromVisualZone(rawText: string): DocOcrFields {
  const text = rawText.replace(/ /g, " ");

  const found = new Set<string>();
  for (const m of text.matchAll(DATE_RE)) {
    const iso = toIso(Number(m[1]), Number(m[2]), Number(m[3]));
    if (iso) found.add(iso);
  }
  const dates = [...found].sort();

  // Numéro de document : la plus longue suite alphanumérique « sérieuse »
  // (≥ 8 caractères, au moins 5 chiffres) — évite d'attraper des mots.
  let document_number: string | null = null;
  for (const token of text.toUpperCase().split(/[^A-Z0-9]+/)) {
    if (token.length < 8) continue;
    const digits = token.replace(/\D/g, "").length;
    if (digits < 5) continue;
    if (!document_number || token.length > document_number.length) {
      document_number = token;
    }
  }

  return {
    // La date la plus TARDIVE d'un permis est son expiration ; la plus
    // ANCIENNE, la naissance. Avec moins de 2 dates, on ne conclut rien.
    expiry_date: dates.length >= 2 ? dates[dates.length - 1] : null,
    birth_date: dates.length >= 2 ? dates[0] : null,
    dates,
    document_number,
  };
}
