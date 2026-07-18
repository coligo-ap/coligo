// =============================================================================
// Pilotage Codemagic (builds iOS) via l'API REST.
//   node scripts/codemagic-build.mjs status            → 5 derniers builds
//   node scripts/codemagic-build.mjs trigger           → lance ios-client-app-store (main)
//   node scripts/codemagic-build.mjs logs <buildId>    → étapes + erreurs d'un build
// Prérequis : CODEMAGIC_API_TOKEN dans .env.local (Codemagic → Personal
// Account → Integrations → Codemagic API → Show). Le token n'est accessible
// QUE depuis la session web du propriétaire — impossible à créer par API.
// =============================================================================

import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = readFileSync(join(root, ".env.local"), "utf8");
const token = env.match(/^CODEMAGIC_API_TOKEN=(.+)$/m)?.[1]?.trim();
if (!token) {
  console.error(
    "✖ CODEMAGIC_API_TOKEN absent de .env.local.\n" +
      "  Créer : https://codemagic.io/teams → Personal Account → " +
      "Integrations → Codemagic API → Show → coller dans .env.local :\n" +
      "  CODEMAGIC_API_TOKEN=cm_…"
  );
  process.exit(1);
}

const API = "https://api.codemagic.io";
const headers = { "x-auth-token": token, "Content-Type": "application/json" };

async function getApp() {
  const res = await fetch(`${API}/apps`, { headers });
  if (!res.ok) throw new Error(`GET /apps → ${res.status}`);
  const { applications } = await res.json();
  const app =
    applications.find((a) => /coligo/i.test(a.appName)) ?? applications[0];
  if (!app) throw new Error("Aucune app Codemagic sur ce compte.");
  return app;
}

const cmd = process.argv[2] ?? "status";

if (cmd === "status") {
  const app = await getApp();
  const res = await fetch(`${API}/builds?appId=${app._id}&limit=5`, {
    headers,
  });
  const { builds } = await res.json();
  console.log(`App : ${app.appName} (${app._id})`);
  for (const b of builds ?? []) {
    console.log(
      `#${b.index ?? "?"}  ${String(b.status).padEnd(10)} ${b.branch}  ` +
        `${b.workflowId ?? ""}  ${new Date(b.startedAt ?? b.createdAt).toISOString().slice(5, 16)}  ${b._id}`
    );
  }
} else if (cmd === "trigger") {
  const app = await getApp();
  const res = await fetch(`${API}/builds`, {
    method: "POST",
    headers,
    body: JSON.stringify({
      appId: app._id,
      workflowId: "ios-client-app-store",
      branch: "main",
    }),
  });
  const body = await res.json();
  if (!res.ok) throw new Error(JSON.stringify(body));
  console.log("Build lancé :", body.buildId ?? JSON.stringify(body));
} else if (cmd === "logs") {
  const buildId = process.argv[3];
  if (!buildId) throw new Error("usage: logs <buildId>");
  const res = await fetch(`${API}/builds/${buildId}`, { headers });
  const { build } = await res.json();
  console.log("Statut :", build.status);
  for (const a of build.buildActions ?? []) {
    console.log(
      `  ${String(a.status ?? "?").padEnd(9)} ${a.name}` +
        (a.status === "failed" ? "  ← ÉCHEC ICI" : "")
    );
  }
} else {
  console.error("commande inconnue :", cmd);
  process.exit(1);
}
