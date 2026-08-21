// =============================================================================
// Activation Cloudflare Turnstile — pose les 2 clés partout où il faut
// =============================================================================
// Prérequis (2 minutes, une seule fois) : https://dash.cloudflare.com →
// Turnstile → « Add widget » :
//   - Hostnames : coligo.app + commercant.coligo.app (et localhost pour le dev)
//   - Mode : « Managed » (invisible sauf doute) — JAMAIS « Interactive only »
// Cloudflare fournit une SITE KEY (publique, 0x4…) et une SECRET KEY (0x4…).
//
// Usage :
//   node scripts/security/enable-turnstile.mjs <SITE_KEY> <SECRET_KEY>
//
// Effets :
//   1. Upsert des env vars Vercel (production + preview + development) via
//      l'API REST (jamais `vercel env add` : piège BOM PowerShell connu).
//   2. Ajout dans .env.local pour le dev local.
//   3. Au prochain déploiement, le captcha s'active TOUT SEUL sur les
//      inscriptions (5 rôles) et le reset mot de passe — le code est déjà
//      branché et dormant.
//
// ⚠️ NE PAS activer le captcha GoTrue côté Supabase (« Enable Captcha
// protection ») pour l'instant : les LOGINS n'envoient pas de token — ça
// casserait toutes les connexions. Voir docs/SECURITE.md § Phase 3.
// =============================================================================

import { readFileSync, appendFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PROJECT_ID = "prj_NrVeAcDZHDN4yrMlMWPXfgWX1ITw";
const TEAM_ID = "team_pdrAXZdXdLoIY5W2x8Ot74tU";

const [siteKey, secretKey] = process.argv.slice(2);
if (!siteKey || !secretKey) {
  console.log(
    "Usage : node scripts/security/enable-turnstile.mjs <SITE_KEY> <SECRET_KEY>"
  );
  process.exit(1);
}

const envFile = join(ROOT, ".env.local");
const envRaw = readFileSync(envFile, "utf8");
const token = envRaw
  .split(/\r?\n/)
  .find((l) => l.startsWith("VERCEL_TOKEN="))
  ?.slice("VERCEL_TOKEN=".length)
  .trim();
if (!token) {
  console.error("VERCEL_TOKEN absent de .env.local");
  process.exit(1);
}

const vars = [
  { key: "NEXT_PUBLIC_TURNSTILE_SITE_KEY", value: siteKey },
  { key: "TURNSTILE_SECRET_KEY", value: secretKey },
];

for (const v of vars) {
  const res = await fetch(
    `https://api.vercel.com/v10/projects/${PROJECT_ID}/env?teamId=${TEAM_ID}&upsert=true`,
    {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        key: v.key,
        value: v.value,
        type: "encrypted",
        target: ["production", "preview", "development"],
      }),
    }
  );
  if (!res.ok) {
    console.error(`Échec ${v.key} (HTTP ${res.status}) : ${await res.text()}`);
    process.exit(1);
  }
  console.log(`✅ Vercel : ${v.key} posée`);
}

for (const v of vars) {
  if (!envRaw.includes(`${v.key}=`)) {
    appendFileSync(envFile, `\n${v.key}=${v.value}`);
    console.log(`✅ .env.local : ${v.key} ajoutée`);
  } else {
    console.log(`ℹ️ .env.local : ${v.key} déjà présente — vérifie sa valeur`);
  }
}

console.log(
  "\nDernière étape : redéployer (n'importe quel push sur main) pour que le " +
    "captcha s'active sur les inscriptions et le reset mot de passe."
);
