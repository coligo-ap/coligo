/**
 * Helper partagé pour les scripts DB.
 *
 * Construit la connection string du pooler Supabase à partir du mot de passe
 * (SUPABASE_DB_PASSWORD, lu depuis l'environnement ou .env.local) et lance le
 * CLI supabase via `node` directement — sans shell, donc aucun souci de
 * quoting Windows avec les caractères spéciaux de l'URL/mot de passe.
 *
 * Source de vérité de la connexion : alignée avec lib/config/database.ts.
 */

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Pooler Supabase — eu-west-1, mode session (port 5432, requis pour migrations).
const DB_USER = "postgres.htxqzktwuymzetbdqghx";
const DB_HOST = "aws-0-eu-west-1.pooler.supabase.com";
const DB_PORT = 5432;
const DB_NAME = "postgres";

/** Charge .env.local sans écraser les variables déjà présentes (Vercel/CI). */
function loadEnvLocal() {
  let content;
  try {
    content = readFileSync(join(ROOT, ".env.local"), "utf8");
  } catch {
    return; // pas de .env.local (ex. en CI) — on s'appuie sur process.env
  }
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    const key = m[1];
    let val = m[2];
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[key] === undefined) process.env[key] = val;
  }
}

/** Connection string complète du pooler (mot de passe URL-encodé). */
export function getDbUrl() {
  loadEnvLocal();
  const password = process.env.SUPABASE_DB_PASSWORD;
  if (!password) {
    console.error(
      "❌ SUPABASE_DB_PASSWORD manquant.\n" +
        "   Ajoute-le dans .env.local (et sur Vercel : Settings > Environment Variables)."
    );
    process.exit(1);
  }
  return `postgresql://${DB_USER}:${encodeURIComponent(
    password
  )}@${DB_HOST}:${DB_PORT}/${DB_NAME}`;
}

/**
 * Lance le CLI supabase avec les args fournis, en injectant --db-url.
 * Exit avec le même code que le CLI.
 */
export function runSupabase(args) {
  const cli = join(ROOT, "node_modules", "supabase", "dist", "supabase.js");
  const full = [cli, ...args, "--db-url", getDbUrl()];
  const res = spawnSync(process.execPath, full, { stdio: "inherit" });
  process.exit(res.status ?? 1);
}
