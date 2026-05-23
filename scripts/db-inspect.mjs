/**
 * Petit utilitaire pour inspecter la DB rapidement (debug seed).
 * Usage : node scripts/db-inspect.mjs
 */
import pg from "pg";
import { getDbUrl } from "./_supabase.mjs";

const client = new pg.Client({
  connectionString: getDbUrl(),
  ssl: { rejectUnauthorized: false },
});

async function main() {
  await client.connect();
  try {
    const queries = [
      ["merchants", "SELECT count(*)::int n FROM public.merchants"],
      ["customers", "SELECT count(*)::int n FROM public.customers"],
      ["products", "SELECT count(*)::int n FROM public.products"],
      ["categories", "SELECT count(*)::int n FROM public.categories"],
      ["orders", "SELECT count(*)::int n FROM public.orders"],
      ["auth.users", "SELECT count(*)::int n FROM auth.users"],
    ];
    for (const [label, q] of queries) {
      const { rows } = await client.query(q);
      console.log(`${label.padEnd(14)} ${rows[0].n}`);
    }
    console.log("\nSample merchants:");
    const { rows: m } = await client.query(
      "SELECT name, category, slug, wilaya_code, commune, is_active FROM public.merchants ORDER BY created_at DESC LIMIT 10"
    );
    console.table(m);
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
