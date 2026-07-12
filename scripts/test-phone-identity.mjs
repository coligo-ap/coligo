// Le numéro de téléphone est l'IDENTIFIANT de connexion du livreur, du chauffeur
// et de l'Agent Coligo Pay : il devient un email synthétique
// `<chiffres>@<population>.coligo.local`. Deux normalisations différentes du même
// numéro = deux comptes. Ce test verrouille les deux propriétés qui l'empêchent :
//
//   1. CONVERGENCE — toutes les façons d'écrire un numéro donnent le même email.
//   2. COMPATIBILITÉ — aucun compte DÉJÀ EN BASE ne devient injoignable.
//
// La dérivation est réimplémentée ici, indépendamment de `lib/auth/phone-identity.ts`,
// pour que le test échoue si l'implémentation dérive.
//
// Exécution : node --experimental-strip-types scripts/test-phone-identity.mjs

import {
  composePhone,
  formatNational,
  normalizeContactPhone,
  splitPhone,
} from "../lib/dz/phone.ts";
import { getDbUrl } from "./_supabase.mjs";

let pass = 0;
let fail = 0;
const ok = (cond, label) =>
  cond
    ? (pass++, console.log("  ✅", label))
    : (fail++, console.log("  ❌", label));

/** Réimplémentation INDÉPENDANTE de `phoneToAuthEmail`. */
const authEmail = (raw, domain) => {
  const canonical = normalizeContactPhone(raw);
  return canonical ? `${canonical.replace(/\D/g, "")}@${domain}` : null;
};

const DRIVERS = "drivers.coligo.local";

console.log("\n1. Convergence — le même numéro, écrit de six façons");
{
  // Le numéro qui a produit le bug : « Email address "0603044620@…" is invalid ».
  const variants = [
    "0603044620",
    "06 03 04 46 20",
    "603044620",
    "+213603044620",
    "+213 6 03 04 46 20",
    "00213603044620",
  ];
  const emails = new Set(variants.map((v) => authEmail(v, DRIVERS)));
  ok(emails.size === 1, `six saisies → un seul email (${[...emails][0]})`);
  ok(
    [...emails][0] === `0603044620@${DRIVERS}`,
    "l'email retenu est celui de la forme locale algérienne"
  );
}

console.log("\n2. Chiffres seuls ≠ forme canonique : le piège d'origine");
{
  // L'ancienne dérivation : raw.replace(/\D/g, "").
  const naive = (raw) => `${raw.replace(/\D/g, "")}@${DRIVERS}`;
  ok(
    naive("0603044620") !== naive("+213603044620"),
    "l'ancienne dérivation fabriquait bien DEUX comptes"
  );
  ok(
    authEmail("0603044620", DRIVERS) === authEmail("+213603044620", DRIVERS),
    "la nouvelle n'en fabrique qu'un"
  );
}

console.log("\n3. Hors Algérie — E.164 conservé");
{
  ok(
    authEmail("+33 6 03 04 46 19", DRIVERS) === `33603044619@${DRIVERS}`,
    "un mobile français garde son indicatif dans l'email"
  );
  ok(
    authEmail("+33603044619", DRIVERS) !== authEmail("0603044619", DRIVERS),
    "un français et un algérien aux mêmes chiffres restent deux comptes"
  );
}

console.log(
  "\n3 bis. Indicatif sélectionné — avec/sans 0 et indicatif répété = MÊME numéro"
);
{
  // Règle produit : le 0 initial est optionnel (« comme chez les grands
  // opérateurs »), et un indicatif recollé dans le champ (autofill,
  // copier-coller) ne doit JAMAIS produire un autre identifiant.
  const frVariants = [
    "0603044618",
    "603044618",
    "6 03 04 46 18",
    "+33 6 03 04 46 18",
    "0033 603 044 618",
    "33 603 044 618",
  ];
  const composedFr = new Set(frVariants.map((v) => composePhone("+33", v)));
  ok(
    composedFr.size === 1 && [...composedFr][0] === "+33603044618",
    `FR : six saisies → un seul numéro (${[...composedFr][0]})`
  );

  const dzVariants = ["0603044618", "603044618", "+213 603 04 46 18"];
  const composedDz = new Set(dzVariants.map((v) => composePhone("+213", v)));
  ok(
    composedDz.size === 1 && [...composedDz][0] === "0603044618",
    "DZ : avec ou sans 0, avec ou sans indicatif → la forme locale 0X…"
  );

  // Garde-fou : un vrai numéro qui COMMENCE par les chiffres de l'indicatif
  // (mobile italien 393… sous +39) n'est pas amputé.
  ok(
    composePhone("+39", "3934567890") === "+393934567890",
    "IT : un national commençant par 39 n'est pas confondu avec l'indicatif"
  );
}

console.log("\n4. Refus des numéros invalides");
{
  for (const bad of ["", "abc", "012345", "0412345678", "+1"]) {
    ok(authEmail(bad, DRIVERS) === null, `« ${bad || "(vide)"} » refusé`);
  }
}

console.log("\n5. splitPhone ∘ composePhone = identité");
{
  for (const stored of ["0603044620", "+33603044619", "+34612345678"]) {
    const { dial, national } = splitPhone(stored);
    ok(composePhone(dial, national) === stored, `aller-retour sur ${stored}`);
  }
  const unknown = splitPhone("+216123456789");
  ok(
    unknown.dial === "+213" && unknown.national === "+216123456789",
    "un indicatif retiré de la liste n'est pas réattribué en silence"
  );
}

console.log("\n6. Formatage d'affichage");
{
  ok(
    formatNational("+213", "0603044620") === "06 03 04 46 20",
    "l'Algérie se lit par paires"
  );
  ok(
    composePhone("+213", formatNational("+213", "0603044620")) === "0603044620",
    "le formatage n'altère pas la valeur canonique"
  );
}

console.log("\n7. Compatibilité — les comptes déjà en base restent joignables");
{
  const { Client } = await import("pg");
  const client = new Client({
    connectionString: getDbUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  const populations = [
    ["drivers", DRIVERS],
    ["chauffeurs", "chauffeurs.coligo.local"],
  ];
  for (const [table, domain] of populations) {
    const { rows } = await client.query(
      `select u.email, t.phone
         from public.${table} t
         join auth.users u on u.id = t.user_id
        where u.email like '%@${domain}'`
    );
    for (const { email, phone } of rows) {
      ok(
        authEmail(phone, domain) === email,
        `${table} · ${phone} → ${email.split("@")[0]}`
      );
    }
    if (rows.length === 0) console.log(`  (aucun compte ${table})`);
  }
  await client.end();
}

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
