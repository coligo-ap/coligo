/**
 * CI — calcule le PROCHAIN versionCode Android et l'écrit dans build.gradle.
 *
 *   node scripts/ci-android-versioncode.mjs
 *
 * Source de vérité = Google Play : on prend le versionCode le PLUS ÉLEVÉ jamais
 * uploadé (tous bundles) + 1. Robuste vis-à-vis des builds locaux ET CI (aucune
 * collision « Version code X has already been used »). Écrit aussi le code dans
 * `android/.ci-versioncode` pour l'étape de publication.
 *
 * Auth : play-service-account.json (écrit depuis un secret Codemagic en amont).
 */
import { readFileSync, writeFileSync } from "node:fs";
import { resolve, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { JWT } from "google-auth-library";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const GRADLE = join(ROOT, "android", "app", "build.gradle");
const PACKAGE = "app.coligo.client";

const key = JSON.parse(
  readFileSync(resolve(ROOT, "play-service-account.json"), "utf8")
);
const jwt = new JWT({
  email: key.client_email,
  key: key.private_key,
  scopes: ["https://www.googleapis.com/auth/androidpublisher"],
});
const { token } = await jwt.getAccessToken();
const H = {
  Authorization: `Bearer ${token}`,
  "Content-Type": "application/json",
};
const base = `https://androidpublisher.googleapis.com/androidpublisher/v3/applications/${PACKAGE}`;

async function api(method, path) {
  const r = await fetch(`${base}${path}`, { method, headers: H });
  if (!r.ok) throw new Error(`${method} ${path} → ${r.status}`);
  return r.status === 204 ? null : r.json();
}

const edit = await api("POST", "/edits");
let max = 0;
try {
  const bundles = await api("GET", `/edits/${edit.id}/bundles`);
  for (const b of bundles?.bundles ?? []) {
    max = Math.max(max, Number(b.versionCode) || 0);
  }
} finally {
  await api("DELETE", `/edits/${edit.id}`).catch(() => {});
}

const next = max + 1;
const newName = `1.0.${next}`;

// Écriture dans le bloc `client { … }` UNIQUEMENT (le flavor commerce a le sien).
const src = readFileSync(GRADLE, "utf8");
const idx = src.indexOf("client {");
if (idx < 0) throw new Error("bloc `client {` introuvable");
const before = src.slice(0, idx);
const block = src
  .slice(idx)
  .replace(/versionCode \d+/, `versionCode ${next}`)
  .replace(/versionName "[^"]+"/, `versionName "${newName}"`);
writeFileSync(GRADLE, before + block, "utf8");
writeFileSync(join(ROOT, "android", ".ci-versioncode"), String(next));

console.log(
  `✅ versionCode ${next} (Play max ${max} + 1), versionName ${newName}`
);
