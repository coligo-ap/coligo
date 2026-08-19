// =============================================================================
// Remplace les CAPTURES D'ÉCRAN de la fiche Google Play par le panorama généré
// — TÉLÉPHONE + TABLETTES 7" et 10", pour TOUTES les langues de la fiche
// (demande du 19/08 : « tous les écrans et tailles »).
//
// Google Play exige une « édition » : on ouvre, on modifie, on valide. Tant que
// l'édition n'est pas validée, rien n'est visible — et si le script échoue en
// route, l'édition abandonnée n'a AUCUN effet sur la fiche en ligne.
//
// ⚠️ L'upload REMPLACE : on efface d'abord les captures existantes du couple
// langue × type, puis on envoie les nouvelles dans l'ordre.
// Sources : téléphone = store-assets/coligo_store_0X.png (1320×2868) ;
// tablettes = déclinaisons blur-pad store-assets/play-7 et play-10.
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
  ["phoneScreenshots", "store-assets"],
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
const { token } = await auth.getAccessToken();
const H = { Authorization: `Bearer ${token}` };
const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}`;

/** fetch avec 3 tentatives — le réseau vers Google tombe parfois en timeout
 *  transitoire (vécu 19/08 : UND_ERR_CONNECT_TIMEOUT en plein upload). */
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
    resolve(root, `${dir}/coligo_store_0${i + 1}.png`)
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
  await rfetch(`${base}/edits`, { method: "POST", headers: H })
).json();
if (!edit.id) {
  console.error("Édition impossible :", JSON.stringify(edit).slice(0, 300));
  process.exit(1);
}
console.log(`Édition ${edit.id} ouverte`);

if (DRY) {
  await rfetch(`${base}/edits/${edit.id}`, { method: "DELETE", headers: H });
  console.log("Essai à blanc — édition abandonnée, fiche intacte.");
  process.exit(0);
}

// 2) Pour chaque langue × type : effacer puis envoyer DANS L'ORDRE.
for (const lang of LANGS) {
  for (const [type, dir] of TYPES) {
    await rfetch(`${base}/edits/${edit.id}/listings/${lang}/${type}`, {
      method: "DELETE",
      headers: H,
    });
    for (const [i, file] of shotsFor(dir).entries()) {
      const body = readFileSync(file);
      const res = await rfetch(
        `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${PACKAGE}/edits/${edit.id}/listings/${lang}/${type}?uploadType=media`,
        { method: "POST", headers: { ...H, "Content-Type": "image/png" }, body }
      );
      if (!res.ok) {
        const j = await res.json();
        console.error(
          `${lang}/${type} volet ${i + 1} refusé :`,
          JSON.stringify(j).slice(0, 300)
        );
        await rfetch(`${base}/edits/${edit.id}`, {
          method: "DELETE",
          headers: H,
        });
        process.exit(1);
      }
    }
    console.log(`${lang} · ${type} : 7 captures ✓`);
  }
}

// 3) Valider — c'est SEULEMENT ici que la fiche change.
const commit = await (
  await rfetch(`${base}/edits/${edit.id}:commit`, {
    method: "POST",
    headers: H,
  })
).json();
console.log(
  commit.id
    ? '✅ Fiche mise à jour — téléphone + tablettes 7"/10", 3 langues.'
    : `Validation refusée : ${JSON.stringify(commit).slice(0, 300)}`
);
