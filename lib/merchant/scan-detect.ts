/**
 * Détection du TYPE d'identifiant scanné sur l'écran unifié « Valider »
 * (SPEC-FIDELITE 2.1). Module PUR (zéro React) : importé par
 * `pickup-validator.tsx` ET par le test de non-régression
 * `scripts/test-scan-routing.mjs` (node --experimental-strip-types).
 *
 * ⚠️ ISO-RÉGRESSION (exigence propriétaire) : `extractPickupCode` et
 * `extractOrderRef` sont déplacés ici VERBATIM depuis pickup-validator —
 * NE PAS les modifier. La fidélité s'insère AVANT eux dans le routage,
 * jamais dedans. Le serveur re-vérifie systématiquement (un QR forgé qui
 * passerait la forme est rejeté par loyalty_resolve_* / validatePickupCode).
 */

/**
 * Extrait un code 6 chiffres d'une string scannée. Le QR Coligo encode
 * directement les 6 chiffres ; par tolérance on accepte aussi une URL
 * legacy avec `?code=XXXXXX`. Tout autre format → `null`.
 *
 * Important : on ne fait PAS de `replace(/\D/g, "")` global sur l'input —
 * une URL avec shortRef alphanumérique (`1C747D`) contient des chiffres
 * parasites qui contamineraient le code (bug v3 résolu).
 */
export function extractPickupCode(raw: string): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return null;
  // Format dominant : 6 chiffres bruts (avec espaces internes tolérés)
  if (/^[\s\d]+$/.test(s)) {
    const digits = s.replace(/\D/g, "");
    return digits.length >= 4 && digits.length <= 6 ? digits : null;
  }
  // Tolérance URL legacy : on extrait le param `code`
  try {
    const url = new URL(s);
    const code = url.searchParams.get("code");
    if (code && /^\d{4,6}$/.test(code)) return code;
  } catch {
    /* pas une URL valide */
  }
  return null;
}

/**
 * Référence publique de commande — c'est ce qu'encode le QR IMPRIMÉ sur le
 * ticket (ex. « A042 », `#` toléré). Le serveur ne validera que si une seule
 * commande retrait PRÊTE du commerçant correspond.
 */
export function extractOrderRef(raw: string): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim().replace(/^#/, "").toUpperCase();
  return /^[A-Z0-9]{2,8}$/.test(s) && /\d/.test(s) ? s : null;
}

/** Code carte fidélité : 16 caractères Crockford (mig 0453). */
const CARD_CODE_RE = /^[A-HJ-NP-Z2-9]{16}$/;

function normalizeCardCode(candidate: string): string | null {
  const v = candidate.replace(/[\s-]/g, "").toUpperCase();
  return CARD_CODE_RE.test(v) ? v : null;
}

/**
 * Identifiant FIDÉLITÉ (SPEC 2.1) — trois formes, espaces d'identifiants
 * DISTINCTS des commandes (aucune collision possible) :
 *   • `coligo:user:<handle>`  → QR personnel du client (son compte = sa carte)
 *   • URL contenant `/c/<code>` → QR imprimé sur la carte physique
 *   • code 16 caractères Crockford (espaces/tirets/casse tolérés)
 *
 * Renvoie l'identifiant à transmettre au serveur (qui re-parse et re-vérifie
 * TOUT via loyalty_parse_identifier), ou `null` si ce n'est pas de la
 * fidélité — le routage retombe alors sur les parsings commande existants.
 */
export function extractLoyaltyIdentifier(raw: string): string | null {
  if (typeof raw !== "string") return null;
  const s = raw.trim();
  if (!s) return null;
  // QR personnel du client (déjà en prod côté wallet).
  if (/^coligo:user:.+/i.test(s)) return s;
  // URL de carte : .../c/<code> (query/fragment tolérés).
  if (/\/c\//i.test(s)) {
    const m = s.match(/\/c\/([A-Za-z0-9 -]{10,40})/i);
    if (m && normalizeCardCode(m[1])) return s;
    return null;
  }
  // Numéro de carte tapé/scanné brut (jamais 4-6 chiffres ni une réf 2-8).
  return normalizeCardCode(s);
}

/** Type de scan, pour le routage de l'écran unifié. */
export type ScanKind =
  | { kind: "loyalty"; identifier: string }
  | { kind: "pickup"; code: string }
  | { kind: "order_ref"; ref: string }
  | { kind: "unknown" };

/**
 * Routage complet d'un scan — la fidélité est testée EN PREMIER (insertion
 * avant les parsings commande, qui restent inchangés), puis la chaîne
 * commande EXACTEMENT comme avant (pickup d'abord, référence ensuite).
 */
export function classifyScan(raw: string): ScanKind {
  const loyalty = extractLoyaltyIdentifier(raw);
  if (loyalty) return { kind: "loyalty", identifier: loyalty };
  const code = extractPickupCode(raw);
  if (code) return { kind: "pickup", code };
  const ref = extractOrderRef(raw);
  if (ref) return { kind: "order_ref", ref };
  return { kind: "unknown" };
}
