// =============================================================================
// IDV — MRZ (Machine Readable Zone) : parsing + SOMMES DE CONTRÔLE ICAO 9303.
// Module 100 % PUR (zéro dépendance) testé sur les SPÉCIMENS officiels du
// Doc 9303 (ERIKSSON) par scripts/test-idv-pipeline.mjs.
//
// Formats couverts :
//   • TD3 (passeport, 2 lignes × 44) — passeport algérien biométrique ;
//   • TD1 (carte ID, 3 lignes × 30) — CNI biométrique algérienne (verso).
//
// Chiffre de contrôle : poids 7-3-1 cycliques ; 0-9 = valeur, A-Z = 10-35,
// '<' = 0 ; somme mod 10. Un document dont les checksums ne collent pas est
// soit mal lu (retryable), soit falsifié (signal de fraude) — la distinction
// se fait au niveau du pipeline (mrz_unreadable vs checksums invalides).
// =============================================================================

export type MrzFormat = "td1" | "td3";

export type MrzFields = {
  document_code: string;
  issuing_country: string;
  surname: string;
  given_names: string;
  document_number: string;
  nationality: string;
  /** ISO yyyy-mm-dd. */
  birth_date: string | null;
  sex: "M" | "F" | null;
  /** ISO yyyy-mm-dd. */
  expiry_date: string | null;
  /** Données optionnelles (n° personnel / NIN), épurées des '<'. */
  personal_number: string | null;
};

export type MrzChecks = {
  document_number: boolean;
  birth_date: boolean;
  expiry_date: boolean;
  composite: boolean;
  /** null si le champ optionnel est vide (TD3 uniquement). */
  personal_number: boolean | null;
};

export type MrzResult = {
  format: MrzFormat;
  fields: MrzFields;
  checks: MrzChecks;
  /** Tous les checksums OBLIGATOIRES passent. */
  valid: boolean;
  /** Part de checksums OK ∈ [0,1]. */
  score: number;
  rawLines: string[];
};

const CHARSET = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ<";

function charValue(c: string): number {
  if (c >= "0" && c <= "9") return c.charCodeAt(0) - 48;
  if (c >= "A" && c <= "Z") return c.charCodeAt(0) - 55; // A = 10
  return 0; // '<'
}

/** Chiffre de contrôle ICAO 9303 (poids 7-3-1). */
export function computeCheckDigit(s: string): number {
  const weights = [7, 3, 1];
  let sum = 0;
  for (let i = 0; i < s.length; i++) {
    sum += charValue(s[i]) * weights[i % 3];
  }
  return sum % 10;
}

function checkDigitOk(data: string, cd: string): boolean {
  // Un champ optionnel vide peut porter '<' comme chiffre de contrôle (= 0).
  const expected = cd === "<" ? 0 : cd >= "0" && cd <= "9" ? Number(cd) : -1;
  return expected >= 0 && computeCheckDigit(data) === expected;
}

/** Réparation OCR : dans une position censée être NUMÉRIQUE, corrige les
 *  confusions classiques lettre→chiffre. Jamais l'inverse (les noms restent
 *  intacts). */
const DIGIT_FIX: Record<string, string> = {
  O: "0",
  Q: "0",
  D: "0",
  I: "1",
  L: "1",
  Z: "2",
  S: "5",
  G: "6",
  B: "8",
};

function fixDigits(s: string): string {
  let out = "";
  for (const c of s) out += DIGIT_FIX[c] ?? c;
  return out;
}

/**
 * Réparation OCR SYMÉTRIQUE : dans une position censée être ALPHABÉTIQUE
 * (code document, pays, nationalité, noms), corrige les confusions
 * chiffre→lettre. Sur une carte réelle, tesseract lit « I<DZA… » comme
 * « 1<DZA… » (attrapé par le test E2E).
 */
const LETTER_FIX: Record<string, string> = {
  "0": "O",
  "1": "I",
  "2": "Z",
  "5": "S",
  "6": "G",
  "8": "B",
};

function fixLetters(s: string): string {
  let out = "";
  for (const c of s) out += LETTER_FIX[c] ?? c;
  return out;
}

/** yymmdd → ISO. Naissance : pivot 19xx/20xx ; expiration : toujours 20xx. */
function toIsoDate(yymmdd: string, kind: "birth" | "expiry"): string | null {
  if (!/^\d{6}$/.test(yymmdd)) return null;
  const yy = Number(yymmdd.slice(0, 2));
  const mm = Number(yymmdd.slice(2, 4));
  const dd = Number(yymmdd.slice(4, 6));
  if (mm < 1 || mm > 12 || dd < 1 || dd > 31) return null;
  const nowYY = new Date().getFullYear() % 100;
  const century = kind === "expiry" ? 20 : yy <= nowYY + 1 ? 20 : 19;
  return `${century}${yymmdd.slice(0, 2)}-${yymmdd.slice(2, 4)}-${yymmdd.slice(4, 6)}`;
}

function parseNames(zone: string): { surname: string; given_names: string } {
  const [surname = "", given = ""] = zone.split("<<");
  const clean = (s: string) => s.replace(/</g, " ").replace(/\s+/g, " ").trim();
  return { surname: clean(surname), given_names: clean(given) };
}

const stripFillers = (s: string) => s.replace(/</g, "").trim() || null;

/**
 * Normalise des lignes candidates : majuscules, espaces retirés, caractères
 * hors alphabet MRZ rejetés, et ne garde que les lignes plausibles.
 */
export function normalizeMrzLines(raw: string[]): string[] {
  return raw
    .map((l) => l.toUpperCase().replace(/\s/g, ""))
    .filter(
      (l) =>
        // Les fillers '<' de FIN de ligne se perdent souvent à l'OCR (mesuré
        // sur carte réelle) : on accepte les lignes tronquées, elles seront
        // re-paddées — la zone perdue est du remplissage, pas de la donnée.
        l.length >= 20 &&
        l.includes("<") &&
        [...l].every((c) => CHARSET.includes(c))
    );
}

function parseTd3(l1: string, l2: string): MrzResult {
  const docNumber = l2.slice(0, 9);
  const docNumberCd = l2[9];
  const birth = fixDigits(l2.slice(13, 19));
  const birthCd = fixDigits(l2[19]);
  const expiry = fixDigits(l2.slice(21, 27));
  const expiryCd = fixDigits(l2[27]);
  const personal = l2.slice(28, 42);
  const personalCd = l2[42];
  const compositeCd = fixDigits(l2[43]);
  const compositeData = l2.slice(0, 10) + l2.slice(13, 20) + l2.slice(21, 43);

  const personalEmpty = stripFillers(personal) === null;
  const checks: MrzChecks = {
    document_number: checkDigitOk(docNumber, fixDigits(docNumberCd)),
    birth_date: checkDigitOk(birth, birthCd),
    expiry_date: checkDigitOk(expiry, expiryCd),
    composite: checkDigitOk(compositeData, compositeCd),
    personal_number: personalEmpty
      ? null
      : checkDigitOk(personal, fixDigits(personalCd)),
  };

  const names = parseNames(fixLetters(l1.slice(5)));
  const sexChar = l2[20];
  const fields: MrzFields = {
    document_code: stripFillers(fixLetters(l1.slice(0, 2))) ?? "P",
    issuing_country: fixLetters(l1.slice(2, 5)).replace(/</g, ""),
    ...names,
    document_number: docNumber.replace(/</g, ""),
    nationality: fixLetters(l2.slice(10, 13)).replace(/</g, ""),
    birth_date: toIsoDate(birth, "birth"),
    sex: sexChar === "M" || sexChar === "F" ? sexChar : null,
    expiry_date: toIsoDate(expiry, "expiry"),
    // Champ ALPHANUMÉRIQUE : pas de réparation O→0 (elle corromprait des
    // lettres légitimes — bug attrapé par le spécimen ICAO « ZE184226B »).
    personal_number: stripFillers(personal),
  };

  return finalize("td3", fields, checks, [l1, l2]);
}

function parseTd1(l1: string, l2: string, l3: string): MrzResult {
  const docNumber = l1.slice(5, 14);
  const docNumberCd = l1[14];
  const optional1 = l1.slice(15, 30);
  const birth = fixDigits(l2.slice(0, 6));
  const birthCd = fixDigits(l2[6]);
  const expiry = fixDigits(l2.slice(8, 14));
  const expiryCd = fixDigits(l2[14]);
  const optional2 = l2.slice(18, 29);
  const compositeCd = fixDigits(l2[29]);
  const compositeData =
    l1.slice(5, 30) + l2.slice(0, 7) + l2.slice(8, 15) + l2.slice(18, 29);

  const checks: MrzChecks = {
    document_number: checkDigitOk(docNumber, fixDigits(docNumberCd)),
    birth_date: checkDigitOk(birth, birthCd),
    expiry_date: checkDigitOk(expiry, expiryCd),
    composite: checkDigitOk(compositeData, compositeCd),
    personal_number: null,
  };

  const names = parseNames(fixLetters(l3));
  const sexChar = l2[7];
  // Champs optionnels ALPHANUMÉRIQUES : pas de réparation O→0.
  const personal = [stripFillers(optional1), stripFillers(optional2)]
    .filter(Boolean)
    .join("");
  const fields: MrzFields = {
    document_code: stripFillers(fixLetters(l1.slice(0, 2))) ?? "I",
    issuing_country: fixLetters(l1.slice(2, 5)).replace(/</g, ""),
    ...names,
    document_number: docNumber.replace(/</g, ""),
    nationality: fixLetters(l2.slice(15, 18)).replace(/</g, ""),
    birth_date: toIsoDate(birth, "birth"),
    sex: sexChar === "M" || sexChar === "F" ? sexChar : null,
    expiry_date: toIsoDate(expiry, "expiry"),
    personal_number: personal || null,
  };

  return finalize("td1", fields, checks, [l1, l2, l3]);
}

function finalize(
  format: MrzFormat,
  fields: MrzFields,
  checks: MrzChecks,
  rawLines: string[]
): MrzResult {
  const required = [
    checks.document_number,
    checks.birth_date,
    checks.expiry_date,
    checks.composite,
  ];
  const all = [
    ...required,
    ...(checks.personal_number === null ? [] : [checks.personal_number]),
  ];
  return {
    format,
    fields,
    checks,
    valid: required.every(Boolean) && checks.personal_number !== false,
    score: Math.round((all.filter(Boolean).length / all.length) * 1000) / 1000,
    rawLines,
  };
}

/**
 * Parse des lignes MRZ déjà normalisées. Retourne null si aucune structure
 * TD1/TD3 n'est reconnaissable (≠ checksums invalides : là on retourne un
 * résultat avec `valid=false`).
 */
export function parseMrz(lines: string[]): MrzResult | null {
  const norm = normalizeMrzLines(lines);
  // Sélection par LONGUEUR D'ORIGINE (tolérance OCR : des fillers '<' de fin
  // se perdent), pas après padding — sinon des lignes TD1 paddées
  // deviendraient candidates TD3.
  const td3 = norm
    .filter((l) => l.length >= 36 && l.length <= 48)
    .map((l) => (l.length > 44 ? l.slice(0, 44) : l.padEnd(44, "<")));
  if (td3.length >= 2) {
    const [l1, l2] = td3.slice(-2);
    return parseTd3(l1, l2);
  }
  const td1 = norm
    .filter((l) => l.length >= 20 && l.length <= 34)
    .map((l) => (l.length > 30 ? l.slice(0, 30) : l.padEnd(30, "<")));
  if (td1.length >= 3) {
    const [l1, l2, l3] = td1.slice(-3);
    return parseTd1(l1, l2, l3);
  }
  return null;
}
