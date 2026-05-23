/**
 * Seed RICHE de démo : pousse `supabase/seed-demo.sql` via le pooler
 * (rôle postgres = bypass RLS + accès à auth.users).
 *
 *   npm run db:seed:demo
 *
 * Idempotent : nettoie les lignes seed précédentes (slug 'demo-%' /
 * notes='seed-demo' / email '@demo.coligo.app') avant de tout recréer.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import { getDbUrl } from "./_supabase.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

async function main() {
  const client = new pg.Client({
    connectionString: getDbUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    const sql = readFileSync(join(ROOT, "supabase", "seed-demo.sql"), "utf8");
    console.log("▶ Exécution du seed démo…");
    const res = await client.query(sql);
    console.log("✅ Seed démo terminé.");
    // Le dernier SELECT du SQL renvoie le récap.
    const last = Array.isArray(res) ? res[res.length - 1] : res;
    if (last?.rows) console.table(last.rows);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("❌ Échec du seed démo :", err.message);
  process.exit(1);
});
