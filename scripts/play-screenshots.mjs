// =============================================================================
// Remplace les CAPTURES D'ÉCRAN de la fiche Google Play — TÉLÉPHONE +
// TABLETTES 7" et 10", pour TOUTES les langues (demande du 19/08).
//
// Google Play exige une « édition » : on ouvre, on modifie, on valide. Tant que
// l'édition n'est pas validée, rien n'est visible — un échec en route abandonne
// l'édition et la fiche en ligne reste intacte.
//
// Sources : JPEG q90 (uploads rapides) générés par store-screenshots-build.mjs
// dans store-assets/play-phone, play-7 et play-10.
// PIÈGES vécus (19/08) : un run > 1 h fait EXPIRER l'access token (401 en
// plein upload) → hdr() rafraîchit à chaque requête ; coupures réseau
// transitoires → rfetch 3 tentatives ; débit faible → les 9 blocs
// langue × type partent EN PARALLÈLE (ordre des volets préservé DANS un bloc).
//
// Lancer : node scripts/play-screenshots.mjs [--dry]
// =============================================================================
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { JWT } from "google-auth-library";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE = "app.coligo.client";
const DRY = process.argv.includes("--dry");
const LANGS = ["fr-FR", "ar", "en-US"];
const TYPES = [
  ["phoneScreenshots", "store-assets/play-phone"],
  ["sevenInchScreenshots", "store-assets/play-7"],
  ["tenInchScreenshots", "store-assets/play-10"],
];

const sa = JSON.parse(
  readFileSync(resolve(root, "play-service-account.json"), "utf8")
);
const auth = new JWT({
  email: sa.client_email,
  key: sa.private_key,
  scopes: ["https://www.googleapis.com/auth/androidpublisher"],
});
async function hdr() {
  const { token } = await auth.getAccessToken(); // auto-refresh à expiration
  return { Authorization: `Bearer ${token}` };
}
const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}`;

async function rfetch(url, init) {
  for (let t = 0; ; t++) {
    try {
      return await fetch(url, init);
    } catch (e) {
      if (t >= 2) throw e;
      await new Promise((r) => setTimeout(r, 4000));
    }
  }
}

const shotsFor = (dir) =>
  Array.from({ length: 7 }, (_, i) =>
    resolve(root, `${dir}/coligo_store_0${i + 1}.jpg`)
  );
const missing = TYPES.flatMap(([, d]) => shotsFor(d)).filter(
  (p) => !existsSync(p)
);
if (missing.length) {
  console.error("Captures manquantes :", missing.slice(0, 5).join(", "));
  process.exit(1);
}

// 1) Ouvrir une édition.
const edit = await (
  await rfetch(`${base}/edits`, { method: "POST", headers: await hdr() })
).json();
if (!edit.id) {
  console.error("Édition impossible :", JSON.stringify(edit).slice(0, 300));
  process.exit(1);
}
console.log(`Édition ${edit.id} ouverte`);

if (DRY) {
  await rfetch(`${base}/edits/${edit.id}`, {
    method: "DELETE",
    headers: await hdr(),
  });
  console.log("Essai à blanc — édition abandonnée, fiche intacte.");
  process.exit(0);
}

// 2) Les 9 blocs langue × type EN PARALLÈLE, séquentiel à l'intérieur.
async function doBlock(lang, type, dir) {
  await rfetch(`${base}/edits/${edit.id}/listings/${lang}/${type}`, {
    method: "DELETE",
    headers: await hdr(),
  });
  for (const [i, file] of shotsFor(dir).entries()) {
    const body = readFileSync(file);
    const res = await rfetch(
      `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${PACKAGE}/edits/${edit.id}/listings/${lang}/${type}?uploadType=media`,
      {
        method: "POST",
        headers: { ...(await hdr()), "Content-Type": "image/jpeg" },
        body,
      }
    );
    if (!res.ok) {
      const j = await res.json();
      throw new Error(
        `${lang}/${type} volet ${i + 1} refusé : ${JSON.stringify(j).slice(0, 200)}`
      );
    }
  }
  console.log(`${lang} · ${type} : 7 captures ✓`);
}

const blocks = [];
for (const lang of LANGS)
  for (const [type, dir] of TYPES) blocks.push([lang, type, dir]);
const results = await Promise.allSettled(blocks.map((b) => doBlock(...b)));
const fails = results.filter((r) => r.status === "rejected");
if (fails.length) {
  for (const f of fails)
    console.error("échec :", String(f.reason).slice(0, 220));
  await rfetch(`${base}/edits/${edit.id}`, {
    method: "DELETE",
    headers: await hdr(),
  });
  process.exit(1);
}

// 3) Valider — c'est SEULEMENT ici que la fiche change.
const commit = await (
  await rfetch(`${base}/edits/${edit.id}:commit`, {
    method: "POST",
    headers: await hdr(),
  })
).json();
console.log(
  commit.id
    ? '✅ Fiche mise à jour — téléphone + tablettes 7"/10", 3 langues.'
    : `Validation refusée : ${JSON.stringify(commit).slice(0, 300)}`
);
