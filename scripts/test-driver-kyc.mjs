// Règles de complétude du dossier livreur. Le formulaire (client) et
// `submitDriverDossier` (serveur) appellent tous deux `kycReport()` : une
// divergence ici laisserait passer un dossier incomplet, ou bloquerait un
// dossier complet.
//
// Exécution : node --experimental-strip-types scripts/test-driver-kyc.mjs

import {
  DEFAULT_ID_DOC_KIND,
  ID_DOC_KINDS,
  idDocKindOf,
  kycReport,
  requiredDocTypes,
} from "../lib/driver/kyc.ts";

let pass = 0;
let fail = 0;
const ok = (cond, label) =>
  cond
    ? (pass++, console.log("  ✅", label))
    : (fail++, console.log("  ❌", label));

/** Profil personnel complet, sans véhicule. */
const person = {
  full_name: "Karim Benali",
  date_of_birth: "1995-04-12",
  phone: "0612345678",
  email: null,
  wilaya: "Alger",
  // Retirés du formulaire livreur, conservés en base pour le super-admin.
  address: null,
  id_card_number: null,
  national_id_number: null,
  vehicle_type: null,
  vehicle_brand: null,
  vehicle_model: null,
  vehicle_plate: null,
  vehicle_color: null,
  vehicle_year: null,
};

const bike = { ...person, vehicle_type: "velo" };
const moto = {
  ...person,
  vehicle_type: "moto",
  vehicle_brand: "Yamaha",
  vehicle_model: "NMAX",
  vehicle_plate: "16-12345-24",
  vehicle_color: "Noir",
};

console.log("\n1. Adresse et n° de pièce ne bloquent plus le dossier");
{
  const r = kycReport(bike, { cni: true, selfie: true });
  ok(
    r.complete,
    "vélo + pièce + selfie ⇒ dossier complet, sans adresse ni NIN"
  );
  ok(
    !r.missing.some((m) =>
      /adresse|numéro national|pièce d'identité \(n/i.test(m)
    ),
    "aucun de ces champs n'apparaît dans les manquants"
  );
}

console.log("\n2. Un mineur reste refusé");
{
  const child = { ...bike, date_of_birth: "2015-01-01" };
  const r = kycReport(child, { cni: true, selfie: true });
  ok(!r.complete, "moins de 18 ans ⇒ dossier incomplet");
}

console.log("\n3. Véhicule motorisé : les trois pièces restent exigées");
{
  ok(
    !kycReport(moto, { cni: true, selfie: true }).complete,
    "moto sans permis/carte grise/assurance ⇒ incomplet"
  );
  ok(
    kycReport(moto, {
      cni: true,
      selfie: true,
      permis: true,
      carte_grise: true,
      assurance: true,
    }).complete,
    "moto avec les cinq pièces ⇒ complet"
  );
  const noColor = { ...moto, vehicle_color: null };
  ok(
    !kycReport(noColor, {
      cni: true,
      selfie: true,
      permis: true,
      carte_grise: true,
      assurance: true,
    }).complete,
    "la couleur est désormais obligatoire pour un motorisé"
  );
}

console.log("\n4. Vélo : ni permis, ni carte grise, ni assurance");
{
  const docs = requiredDocTypes("velo");
  ok(docs.length === 2, `deux pièces attendues (${docs.join(", ")})`);
  ok(
    !docs.includes("permis") && !docs.includes("assurance"),
    "ni permis ni assurance pour un non motorisé"
  );
}

console.log("\n5. Nature de la pièce d'identité");
{
  for (const { value } of ID_DOC_KINDS) {
    ok(
      kycReport(bike, { [value]: true, selfie: true }, value).complete,
      `« ${value} » vaut pièce d'identité`
    );
  }
  ok(
    !kycReport(bike, { cni: true, selfie: true }, "passeport").complete,
    "un passeport annoncé mais non déposé ⇒ incomplet, même si la CNI est là"
  );
  ok(
    idDocKindOf({ selfie: true }) === DEFAULT_ID_DOC_KIND,
    "aucune pièce déposée ⇒ on retombe sur la carte d'identité"
  );
  ok(
    idDocKindOf({ passeport: true }) === "passeport",
    "la nature se relit de la pièce déposée (reprise du dossier)"
  );
}

console.log("\n6. Le permis sert deux fois, il ne se dépose qu'une fois");
{
  const docs = requiredDocTypes("moto", "permis");
  ok(
    docs.filter((d) => d === "permis").length === 1,
    `pas de doublon : ${docs.join(", ")}`
  );
  ok(
    kycReport(
      moto,
      {
        permis: true,
        selfie: true,
        carte_grise: true,
        assurance: true,
      },
      "permis"
    ).complete,
    "permis en guise de pièce d'identité ⇒ dossier complet sans CNI"
  );
}

// ── Voie « instantanée » (IDV, mig 0369) ───────────────────────────────────
{
  console.log(
    "\n▸ Vérification INSTANTANÉE (IDV) — aucune pièce d'identité à envoyer"
  );
  const velo = { ...person, vehicle_type: "velo" };

  ok(
    !kycReport(velo, {}, "cni", { method: "instant", verified: false })
      .complete,
    "voie instantanée + identité NON vérifiée ⇒ dossier incomplet"
  );
  ok(
    kycReport(velo, {}, "cni", { method: "instant", verified: true }).complete,
    "voie instantanée + identité vérifiée ⇒ dossier complet SANS téléverser de pièce"
  );
  ok(
    kycReport(velo, {}, "cni", {
      method: "instant",
      verified: false,
    }).missing.some((m) => /identité vérifiée/i.test(m)),
    "l'élément manquant annoncé est bien « identité vérifiée »"
  );
  ok(
    requiredDocTypes("velo", "cni", "instant").length === 0,
    "voie instantanée : aucune pièce d'identité ni selfie attendus"
  );
  ok(
    requiredDocTypes("moto", "cni", "instant").join(",") ===
      "permis,carte_grise,assurance",
    "voie instantanée + motorisé : seules les pièces du VÉHICULE restent exigées"
  );
  ok(
    kycReport(velo, { cni: true, selfie: true }, "cni", {
      method: "manual",
      verified: false,
    }).complete,
    "voie manuelle : le comportement d'avant est inchangé"
  );
}

console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
