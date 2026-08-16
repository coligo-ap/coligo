// =============================================================================
// Icône de la FICHE Play Store (app.coligo.client) ← public/icon-512.png (v2).
//   node scripts/play-app-icon.mjs        → upload pour chaque langue + COMMIT
//
// L'icône DANS l'app (launcher) voyage avec l'AAB (brand-assets.mjs →
// Codemagic) ; celle-ci est l'icône de la FICHE (512×512, ≤ 1 Mo). Côté iOS il
// n'existe pas d'icône de fiche séparée : l'App Store la prend du binaire.
// Auth : play-service-account.json (même compte que play-listing-*.mjs).
// =============================================================================
import { readFileSync } from "node:fs";
import { resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { JWT } from "google-auth-library";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const PACKAGE = "app.coligo.client";
const ICON = resolve(root, "public", "icon-512.png");

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
const upBase = `https://androidpublisher.googleapis.com/upload/androidpublisher/v3/applications/${PACKAGE}`;

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
  if (!res.ok) throw new Error(`${method} ${url} → ${res.status} ${text}`);
  return text ? JSON.parse(text) : null;
}

const icon = readFileSync(ICON);
console.log(`Icône : ${ICON} (${Math.round(icon.length / 1024)} Ko)`);
if (icon.length > 1024 * 1024) {
  console.error("Play impose ≤ 1 Mo pour l'icône de fiche.");
  process.exit(1);
}

const edit = await api("POST", `${base}/edits`);
console.log("Édition ouverte :", edit.id);

const listings = await api("GET", `${base}/edits/${edit.id}/listings`);
const langs = (listings.listings ?? []).map((l) => l.language);
console.log("Langues de fiche :", langs.join(", ") || "(aucune)");

for (const lang of langs) {
  await api("DELETE", `${base}/edits/${edit.id}/listings/${lang}/icon`).catch(
    () => null
  ); // aucune icône existante : sans gravité
  const res = await fetch(
    `${upBase}/edits/${edit.id}/listings/${lang}/icon?uploadType=media`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "image/png",
      },
      body: icon,
    }
  );
  const text = await res.text();
  if (!res.ok) throw new Error(`upload ${lang} → ${res.status} ${text}`);
  console.log(`  ✅ icône posée (${lang})`);
}

// `changesNotSentForReview=true` exigé par Play : les changements sont bien
// COMMITTÉS mais l'envoi en revue se déclenche d'un clic depuis la Console
// (« Vue d'ensemble de la publication » → Envoyer pour révision).
await api(
  "POST",
  `${base}/edits/${edit.id}:commit?changesNotSentForReview=true`
);
console.log(
  "Édition COMMITTÉE. Dernière étape MANUELLE : Play Console → Vue d'ensemble de la publication → Envoyer pour révision."
);
