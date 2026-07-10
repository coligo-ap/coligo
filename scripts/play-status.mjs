// Lecture seule : liste les pistes Play et leurs releases (versionCode + statut).
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { JWT } from "google-auth-library";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE = "app.coligo.client";
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

async function api(method, url) {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  if (!res.ok)
    throw new Error(`${method} ${url}\n→ HTTP ${res.status}\n${text}`);
  return text ? JSON.parse(text) : null;
}

const edit = await api("POST", `${base}/edits`);
const tracks = await api("GET", `${base}/edits/${edit.id}/tracks`);
for (const t of tracks.tracks ?? []) {
  console.log(`\n=== PISTE: ${t.track} ===`);
  for (const r of t.releases ?? []) {
    console.log(
      `  release "${r.name ?? ""}" — status=${r.status} — versionCodes=${JSON.stringify(r.versionCodes ?? [])}`
    );
  }
}
await api("DELETE", `${base}/edits/${edit.id}`);
console.log("\n(edit sondé puis supprimé — zéro effet de bord)");
