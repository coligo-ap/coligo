// Lecture seule : AUDIT de complétude de la fiche Play (app.coligo.client) —
// listings (titre/descriptions par langue), coordonnées, images par type.
// Créé pour préparer la demande d'accès PRODUCTION (rien n'est modifié).
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

async function api(method, url, okStatuses = []) {
  const res = await fetch(url, {
    method,
    headers: { Authorization: `Bearer ${token}` },
  });
  const text = await res.text();
  if (!res.ok) {
    if (okStatuses.includes(res.status)) return null;
    throw new Error(`${method} ${url}\n→ HTTP ${res.status}\n${text}`);
  }
  return text ? JSON.parse(text) : null;
}

const edit = await api("POST", `${base}/edits`);
const eid = edit.id;

const details = await api("GET", `${base}/edits/${eid}/details`);
console.log("── DÉTAILS ──");
console.log("  langue par défaut :", details?.defaultLanguage ?? "—");
console.log("  email contact     :", details?.contactEmail ?? "— (REQUIS)");
console.log("  site web          :", details?.contactWebsite ?? "—");
console.log("  téléphone         :", details?.contactPhone ?? "—");

const listings = await api("GET", `${base}/edits/${eid}/listings`);
console.log("\n── FICHES PAR LANGUE ──");
for (const l of listings?.listings ?? []) {
  console.log(`  [${l.language}]`);
  console.log(`    titre       : ${l.title ? `« ${l.title} »` : "MANQUANT"}`);
  console.log(
    `    courte desc : ${l.shortDescription ? `${l.shortDescription.length} car.` : "MANQUANTE"}`
  );
  console.log(
    `    longue desc : ${l.fullDescription ? `${l.fullDescription.length} car.` : "MANQUANTE"}`
  );
}

const lang = details?.defaultLanguage ?? "fr-FR";
const IMAGE_TYPES = [
  "icon",
  "featureGraphic",
  "phoneScreenshots",
  "sevenInchScreenshots",
  "tenInchScreenshots",
];
console.log(`\n── IMAGES (${lang}) ──`);
for (const type of IMAGE_TYPES) {
  // Chemin réel de l'API : /listings/{lang}/{type} — SANS segment /images/.
  const imgs = await api(
    "GET",
    `${base}/edits/${eid}/listings/${lang}/${type}`,
    [404]
  );
  const n = imgs?.images?.length ?? 0;
  const need =
    type === "icon" || type === "featureGraphic"
      ? n >= 1
      : type === "phoneScreenshots"
        ? n >= 2
        : true;
  console.log(`  ${type.padEnd(22)}: ${n} ${need ? "✓" : "⚠️ INSUFFISANT"}`);
}

await api("DELETE", `${base}/edits/${eid}`);
console.log("\n(edit sondé puis supprimé — zéro effet de bord)");
