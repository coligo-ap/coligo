// Téléverse les VISUELS de la fiche Play (app.coligo.client, langue fr-FR) :
//   --icon <png 512×512>  --feature <png 1024×500>  --shot <png> (répétable)
// Commit normal, repli `changesNotSentForReview` si la console l'exige
// (même stratégie que play-upload.mjs).
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { JWT } from "google-auth-library";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE = "app.coligo.client";
const LANG = "fr-FR";

const args = process.argv.slice(2);
function pick(flag) {
  const out = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === flag && args[i + 1]) out.push(args[i + 1]);
  }
  return out;
}
const icon = pick("--icon")[0];
const feature = pick("--feature")[0];
const shots = pick("--shot");
if (!icon && !feature && shots.length === 0) {
  console.error(
    "Usage: node scripts/play-upload-graphics.mjs [--icon f.png] [--feature f.png] [--shot f.png]..."
  );
  process.exit(1);
}

const key = JSON.parse(
  readFileSync(resolve(root, "play-service-account.json"), "utf8")
);
const jwt = new JWT({
  email: key.client_email,
  key: key.private_key,
  scopes: ["https://www.googleapis.com/auth/androidpublisher"],
});
const { token } = await jwt.getAccessToken();
const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}`;
const uploadBase = `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${PACKAGE}`;

async function api(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(body ? { "Content-Type": "application/json" } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok)
    throw new Error(`${method} ${url}\n→ HTTP ${res.status}\n${text}`);
  return text ? JSON.parse(text) : null;
}

async function uploadImage(editId, type, file) {
  const bin = readFileSync(file);
  const res = await fetch(
    `${uploadBase}/edits/${editId}/listings/${LANG}/${type}?uploadType=media`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "image/png",
      },
      body: bin,
    }
  );
  const text = await res.text();
  if (!res.ok)
    throw new Error(`upload ${type} (${file})\n→ HTTP ${res.status}\n${text}`);
  console.log(`  ✓ ${type} ← ${file} (${(bin.length / 1024).toFixed(0)} Ko)`);
}

const edit = await api("POST", `${base}/edits`);
console.log(`Edit ${edit.id} ouvert.`);

if (icon) await uploadImage(edit.id, "icon", icon);
if (feature) await uploadImage(edit.id, "featureGraphic", feature);
for (const s of shots) await uploadImage(edit.id, "phoneScreenshots", s);

// Commit : normal d'abord, repli sans-review si la console est incomplète.
try {
  await api("POST", `${base}/edits/${edit.id}:commit`);
  console.log("Commit NORMAL réussi — visuels publiés sur la fiche.");
} catch (e) {
  console.warn("Commit normal refusé, repli changesNotSentForReview…");
  console.warn(String(e.message).split("\n").slice(0, 3).join(" "));
  await api(
    "POST",
    `${base}/edits/${edit.id}:commit?changesNotSentForReview=true`
  );
  console.log("Commit (changesNotSentForReview) réussi — visuels enregistrés.");
}
