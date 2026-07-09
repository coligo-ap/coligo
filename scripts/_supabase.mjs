/**
 * Helper partagé pour les scripts DB.
 *
 * Construit la connection string du pooler Supabase à partir du mot de passe
 * (SUPABASE_DB_PASSWORD, lu depuis l'environnement ou .env.local) et lance le
 * CLI supabase via `node` directement — sans shell, donc aucun souci de
 * quoting Windows avec les caractères spéciaux de l'URL/mot de passe.
 *
 * Ce fichier est la SOURCE DE VÉRITÉ de la connexion Postgres directe.
 */

import { readFileSync } from "node:fs";
import { spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Pooler Supabase — eu-west-1, mode session (port 5432, requis pour migrations).
// DEUX environnements : prod (défaut) et dev (projet gvdojuitcexemvkcaqfa).
//   - cible dev : flag `--dev` sur les scripts (npm run db:push -- --dev) ou
//     env COLIGO_DB=dev ; mot de passe lu depuis SUPABASE_DEV_DB_PASSWORD.
const PROJECTS = {
  prod: { ref: "htxqzktwuymzetbdqghx", passwordVar: "SUPABASE_DB_PASSWORD" },
  dev: { ref: "gvdojuitcexemvkcaqfa", passwordVar: "SUPABASE_DEV_DB_PASSWORD" },
};
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
export function getDbUrl(target = process.env.COLIGO_DB ?? "prod") {
  loadEnvLocal();
  const project = PROJECTS[target] ?? PROJECTS.prod;
  const password = process.env[project.passwordVar];
  if (!password) {
    console.error(
      `❌ ${project.passwordVar} manquant.\n` +
        "   Ajoute-le dans .env.local (et sur Vercel : Settings > Environment Variables)."
    );
    process.exit(1);
  }
  return `postgresql://postgres.${project.ref}:${encodeURIComponent(
    password
  )}@${DB_HOST}:${DB_PORT}/${DB_NAME}`;
}

/**
 * Lance le CLI supabase avec les args fournis, en injectant --db-url.
 * `--dev` (retiré des args) cible le projet Supabase de DÉVELOPPEMENT.
 * Exit avec le même code que le CLI.
 */
export function runSupabase(args) {
  const target = args.includes("--dev") ? "dev" : "prod";
  const rest = args.filter((a) => a !== "--dev");
  if (target === "dev")
    console.log("🧪 Cible : Supabase DEV (gvdojuitcexemvkcaqfa)");
  const cli = join(ROOT, "node_modules", "supabase", "dist", "supabase.js");
  const full = [cli, ...rest, "--db-url", getDbUrl(target)];
  const res = spawnSync(process.execPath, full, { stdio: "inherit" });
  process.exit(res.status ?? 1);
}
