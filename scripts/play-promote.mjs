// Promeut un bundle DÉJÀ uploadé vers une autre piste, sans rebuild ni ré-upload.
// Usage : node scripts/play-promote.mjs --to internal --version 16 [--status completed|draft]
// Auth : play-service-account.json (racine, gitignoré). Non destructif : n'affecte
// que la piste --to, laisse les autres pistes intactes.
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { JWT } from "google-auth-library";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE = "app.coligo.client";

const args = process.argv.slice(2);
const opt = (name, dflt) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 && args[i + 1] ? args[i + 1] : dflt;
};
const track = opt("to", "internal");
const version = opt("version");
const status = opt("status", "completed");
if (!version) {
  console.error(
    "Manque --version <versionCode> (ex. 16). Voir `npm run play:status`."
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

console.log(
  `Promotion du versionCode ${version} → piste ${track} (release ${status})`
);
const edit = await api("POST", `${base}/edits`);

// Garde-fou : le bundle doit déjà exister dans la lib de l'app.
const bundles = await api("GET", `${base}/edits/${edit.id}/bundles`);
const codes = (bundles.bundles ?? []).map((b) => String(b.versionCode));
if (!codes.includes(String(version))) {
  await api("DELETE", `${base}/edits/${edit.id}`);
  throw new Error(
    `versionCode ${version} absent des bundles [${codes.join(", ")}] — rien à promouvoir.`
  );
}

await api("PUT", `${base}/edits/${edit.id}/tracks/${track}`, {
  track,
  releases: [{ status, versionCodes: [String(version)] }],
});

async function commitEdit() {
  try {
    await api("POST", `${base}/edits/${edit.id}:commit`);
  } catch (e) {
    if (
      !String(e.message).includes("ReviewRequired") &&
      !String(e.message).includes("NotSentForReview")
    )
      throw e;
    await api(
      "POST",
      `${base}/edits/${edit.id}:commit?changesNotSentForReview=true`
    );
    console.log(
      "(commit sans envoi en review — fiche Play incomplète, OK pour test interne)"
    );
  }
}
await commitEdit();
console.log(`OK — versionCode ${version} (${status}) sur la piste ${track}.`);
