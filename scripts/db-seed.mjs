/**
 * Exécute supabase/seed.sql via le pooler (rôle postgres = bypass RLS).
 *
 *   npm run db:seed              # 1er commerçant trouvé
 *   npm run db:seed -- <merchant_id>
 *
 * Récupère le merchant_id, remplace le placeholder du seed, exécute, puis
 * affiche le nombre de commandes par statut pour vérifier.
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
    const argId = process.argv[2];
    let merchantId = argId;

    if (!merchantId) {
      const { rows } = await client.query(
        "SELECT id, name FROM public.merchants ORDER BY created_at ASC LIMIT 1"
      );
      if (rows.length === 0) {
        console.error(
          "❌ Aucun commerçant en base. Crée un compte commerçant d'abord."
        );
        process.exit(1);
      }
      merchantId = rows[0].id;
      console.log(`▶ Commerçant : ${rows[0].name} (${merchantId})`);
    } else {
      console.log(`▶ Commerçant (argument) : ${merchantId}`);
    }

    const sql = readFileSync(
      join(ROOT, "supabase", "seed.sql"),
      "utf8"
    ).replace(/<MERCHANT_ID>/g, merchantId);

    await client.query(sql);

    const { rows: counts } = await client.query(
      `SELECT status, count(*)::int AS n
       FROM public.orders WHERE merchant_id = $1
       GROUP BY status ORDER BY status`,
      [merchantId]
    );
    console.log("✅ Seed inséré. Commandes par statut :");
    for (const r of counts) console.log(`   ${r.status.padEnd(10)} ${r.n}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("❌ Échec du seed :", err.message);
  process.exit(1);
});
