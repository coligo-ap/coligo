// =============================================================================
// Remplace les CAPTURES D'ÉCRAN de la fiche Google Play par le panorama généré
// (store-assets/coligo_store_01..07.png).
//
// Google Play exige une « édition » : on ouvre, on modifie, on valide. Tant que
// l'édition n'est pas validée, rien n'est visible — et si le script échoue en
// route, l'édition abandonnée n'a AUCUN effet sur la fiche en ligne.
//
// ⚠️ L'upload REMPLACE : on efface d'abord les captures existantes de la langue
// visée, puis on envoie les nouvelles dans l'ordre. C'est voulu — sinon les
// anciennes resteraient mélangées aux nouvelles.
//
// Lancer : node scripts/play-screenshots.mjs [fr-FR] [--dry]
// =============================================================================
import { readFileSync, existsSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { JWT } from "google-auth-library";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE = "app.coligo.client";
const LANG =
  process.argv[2] && !process.argv[2].startsWith("--")
    ? process.argv[2]
    : "fr-FR";
const DRY = process.argv.includes("--dry");
const TYPE = "phoneScreenshots";

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

const shots = Array.from({ length: 7 }, (_, i) =>
  resolve(root, `store-assets/coligo_store_0${i + 1}.png`)
);
const missing = shots.filter((p) => !existsSync(p));
if (missing.length) {
  console.error("Captures manquantes :", missing.join(", "));
  process.exit(1);
}

// 1) Ouvrir une édition.
const edit = await (
  await fetch(`${base}/edits`, { method: "POST", headers: H })
).json();
if (!edit.id) {
  console.error("Édition impossible :", JSON.stringify(edit).slice(0, 300));
  process.exit(1);
}
console.log(`Édition ${edit.id} ouverte · langue ${LANG}`);

// 2) État actuel (pour dire ce qu'on remplace).
const before = await (
  await fetch(`${base}/edits/${edit.id}/listings/${LANG}/${TYPE}`, {
    headers: H,
  })
).json();
console.log("Captures actuelles :", (before.images ?? []).length);

if (DRY) {
  await fetch(`${base}/edits/${edit.id}`, { method: "DELETE", headers: H });
  console.log("Essai à blanc — édition abandonnée, fiche intacte.");
  process.exit(0);
}

// 3) Effacer les anciennes, puis envoyer les nouvelles DANS L'ORDRE.
await fetch(`${base}/edits/${edit.id}/listings/${LANG}/${TYPE}`, {
  method: "DELETE",
  headers: H,
});
console.log("Anciennes captures retirées.");

for (const [i, file] of shots.entries()) {
  const body = readFileSync(file);
  const res = await fetch(
    `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${PACKAGE}/edits/${edit.id}/listings/${LANG}/${TYPE}?uploadType=media`,
    { method: "POST", headers: { ...H, "Content-Type": "image/png" }, body }
  );
  const j = await res.json();
  if (!res.ok) {
    console.error(`Volet ${i + 1} refusé :`, JSON.stringify(j).slice(0, 300));
    // On abandonne l'édition : la fiche en ligne n'est pas touchée.
    await fetch(`${base}/edits/${edit.id}`, { method: "DELETE", headers: H });
    process.exit(1);
  }
  console.log(`Volet ${i + 1}/7 envoyé (${Math.round(body.length / 1024)} Ko)`);
}

// 4) Valider — c'est SEULEMENT ici que la fiche change.
const commit = await (
  await fetch(`${base}/edits/${edit.id}:commit`, { method: "POST", headers: H })
).json();
console.log(
  commit.id
    ? `✅ Fiche mise à jour (${LANG}) — 7 captures en ligne.`
    : `Validation refusée : ${JSON.stringify(commit).slice(0, 300)}`
);
