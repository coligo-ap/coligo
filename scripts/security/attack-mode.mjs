// =============================================================================
// Bascule d'URGENCE — Vercel Attack Challenge Mode
// =============================================================================
// Usage :
//   node scripts/security/attack-mode.mjs on      → active le challenge global
//   node scripts/security/attack-mode.mjs off     → désactive
//   node scripts/security/attack-mode.mjs status  → état actuel
//
// À utiliser PENDANT une attaque volumétrique (L7 flood) : Vercel sert alors un
// challenge JS à CHAQUE nouveau visiteur (~quelques secondes au premier accès).
// ⚠️ Ne pas laisser activé en temps normal : la WebView Capacitor et les
// webhooks (Chargily/Stripe) peuvent en souffrir. C'est un disjoncteur, pas un
// réglage permanent. Repli si l'API échoue : Dashboard Vercel → projet coligo
// → Firewall → « Attack Challenge Mode ».
// =============================================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const PROJECT_ID = "prj_NrVeAcDZHDN4yrMlMWPXfgWX1ITw"; // projet « coligo » (prod)
const TEAM_ID = "team_pdrAXZdXdLoIY5W2x8Ot74tU";

function readToken() {
  const env = readFileSync(join(ROOT, ".env.local"), "utf8");
  const line = env.split(/\r?\n/).find((l) => l.startsWith("VERCEL_TOKEN="));
  if (!line) throw new Error("VERCEL_TOKEN absent de .env.local");
  return line.slice("VERCEL_TOKEN=".length).trim();
}

const token = readToken();
const auth = { Authorization: `Bearer ${token}` };
const mode = process.argv[2];

async function status() {
  const res = await fetch(
    `https://api.vercel.com/v1/security/attack-mode?projectId=${PROJECT_ID}&teamId=${TEAM_ID}`,
    { headers: auth }
  );
  if (!res.ok) {
    console.log(
      `Lecture impossible (HTTP ${res.status}) — vérifie dans le Dashboard : ` +
        "https://vercel.com/coligo-aps-projects/coligo/firewall"
    );
    return;
  }
  const json = await res.json();
  console.log("Attack Challenge Mode :", JSON.stringify(json));
}

async function toggle(enabled) {
  const res = await fetch(
    `https://api.vercel.com/v1/security/attack-mode?teamId=${TEAM_ID}`,
    {
      method: "POST",
      headers: { ...auth, "Content-Type": "application/json" },
      body: JSON.stringify({
        projectId: PROJECT_ID,
        attackModeEnabled: enabled,
      }),
    }
  );
  const body = await res.text();
  if (!res.ok) {
    console.error(`Échec (HTTP ${res.status}) : ${body}`);
    console.error(
      "Repli manuel : https://vercel.com/coligo-aps-projects/coligo/firewall"
    );
    process.exit(1);
  }
  console.log(
    enabled
      ? "✅ Attack Challenge Mode ACTIVÉ — tout nouveau visiteur passe un challenge."
      : "✅ Attack Challenge Mode désactivé — trafic normal rétabli."
  );
}

if (mode === "on") await toggle(true);
else if (mode === "off") await toggle(false);
else if (mode === "status") await status();
else {
  console.log("Usage : node scripts/security/attack-mode.mjs on|off|status");
  process.exit(1);
}
