// =============================================================================
// NON-RÉGRESSION — routage du scanner unifié (SPEC-FIDELITE 2.1/2.2)
// =============================================================================
// Exigence propriétaire (Phase 2) : la détection fidélité s'insère AVANT les
// parsings commande SANS les modifier. Ce test verrouille les DEUX sens :
//   1. tous les formats du flux retrait actuel (PIN 4-6, URL legacy ?code=,
//      référence ticket) routent EXACTEMENT comme avant — jamais avalés par
//      la fidélité ;
//   2. les identifiants fidélité (coligo:user:, URL /c/<code>, code 16 car.)
//      sont détectés — jamais confondus avec un code commande.
// Usage : npm run test:scan   (node --experimental-strip-types)
// =============================================================================

import {
  classifyScan,
  extractLoyaltyIdentifier,
  extractOrderRef,
  extractPickupCode,
} from "../lib/merchant/scan-detect.ts";

let failures = 0;
function assert(cond, label, detail) {
  if (cond) {
    console.log(`  ✅ ${label}`);
  } else {
    failures++;
    console.error(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}
const kindOf = (raw) => classifyScan(raw).kind;

console.log("A — flux retrait INCHANGÉ (PIN client)");
assert(extractPickupCode("4821") === "4821", "A1 PIN 4 chiffres");
assert(extractPickupCode("482133") === "482133", "A2 PIN 6 chiffres");
assert(extractPickupCode(" 48 21 ") === "4821", "A3 espaces internes tolérés");
assert(extractPickupCode("123") === null, "A4 3 chiffres → refusé");
assert(
  extractPickupCode("https://coligo.app/valider?code=482133") === "482133",
  "A5 URL legacy ?code= toujours acceptée"
);
for (const pin of ["4821", "482133", " 48 21 "]) {
  assert(
    kindOf(pin) === "pickup",
    `A6 « ${pin} » route vers le RETRAIT (jamais fidélité)`,
    kindOf(pin)
  );
}
assert(
  kindOf("https://coligo.app/valider?code=4821") === "pickup",
  "A7 URL legacy route vers le RETRAIT",
  kindOf("https://coligo.app/valider?code=4821")
);

console.log("B — flux retrait INCHANGÉ (référence ticket)");
assert(extractOrderRef("A042") === "A042", "B1 référence A042");
assert(extractOrderRef("#a042") === "A042", "B2 # + minuscules tolérés");
assert(extractOrderRef("1C747D") === "1C747D", "B3 shortRef 6 car.");
assert(extractOrderRef("AB") === null, "B4 sans chiffre → refusé");
for (const ref of ["A042", "#a042", "1C747D", "1234567"]) {
  assert(
    kindOf(ref) === "order_ref",
    `B5 « ${ref} » route vers la RÉFÉRENCE (comportement historique)`,
    kindOf(ref)
  );
}

console.log("C — identifiants FIDÉLITÉ détectés");
assert(
  kindOf("coligo:user:k7abn42x") === "loyalty",
  "C1 QR personnel client coligo:user:"
);
assert(
  kindOf("COLIGO:USER:K7ABN42X") === "loyalty",
  "C2 préfixe insensible à la casse"
);
assert(
  kindOf("https://coligo.app/c/ABCD2345EFGH2345") === "loyalty",
  "C3 URL de carte /c/<code>"
);
assert(
  kindOf("https://coligo.app/c/abcd2345efgh2345?src=qr") === "loyalty",
  "C4 URL avec query + minuscules"
);
assert(kindOf("ABCD2345EFGH2345") === "loyalty", "C5 code 16 car. brut");
assert(
  extractLoyaltyIdentifier("abcd-2345-efgh-2345") === "ABCD2345EFGH2345",
  "C6 code groupé/minuscules → normalisé"
);
assert(
  kindOf("ABCD 2345 EFGH 2345") === "loyalty",
  "C7 code avec espaces (saisie imprimée)"
);

console.log("D — AUCUNE confusion entre les espaces d'identifiants");
for (const orderish of [
  "4821",
  "482133",
  "A042",
  "#A042",
  "1C747D",
  "https://coligo.app/valider?code=4821",
]) {
  assert(
    extractLoyaltyIdentifier(orderish) === null,
    `D1 « ${orderish} » n'est JAMAIS de la fidélité`
  );
}
for (const loyaltyish of [
  "coligo:user:k7abn42x",
  "https://coligo.app/c/ABCD2345EFGH2345",
  "ABCD2345EFGH2345",
]) {
  assert(
    extractPickupCode(loyaltyish) === null &&
      extractOrderRef(loyaltyish) === null,
    `D2 « ${loyaltyish} » n'est JAMAIS un code commande`
  );
}

console.log("E — rejets propres");
assert(kindOf("") === "unknown", "E1 vide");
assert(kindOf("hello world") === "unknown", "E2 texte quelconque");
assert(kindOf("https://example.com/menu") === "unknown", "E3 URL étrangère");
assert(
  kindOf("https://coligo.app/c/PAS-UN-CODE") === "unknown",
  "E4 /c/ avec code invalide"
);
assert(
  kindOf("ABCD1234EFGH5678") === "unknown",
  "E5 16 car. hors alphabet Crockford (contient 1)"
);
assert(
  kindOf("coligo:pay:token123") === "unknown",
  "E6 QR Coligo Pay ignoré ici"
);

console.log(
  failures === 0
    ? "\n✅ Routage du scanner unifié : zéro régression."
    : `\n❌ ${failures} échec(s).`
);
process.exit(failures === 0 ? 0 : 1);
