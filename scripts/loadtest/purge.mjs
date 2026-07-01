// Purge TOTALE des résidus de test de charge (@coligo-loadtest.dev / [LOADTEST]).
import pg from "pg";
import { getDbUrl } from "../_supabase.mjs";
const c = new pg.Client({
  connectionString: getDbUrl(),
  ssl: { rejectUnauthorized: false },
});
await c.connect();
try {
  await c.query("SET session_replication_role = replica").catch(() => {});
  const U = `(SELECT id FROM auth.users WHERE email LIKE '%@coligo-loadtest.dev')`;
  const CU = `(SELECT id FROM customers WHERE user_id IN ${U})`;
  const M = `(SELECT id FROM merchants WHERE user_id IN ${U})`;
  const CH = `(SELECT id FROM chauffeurs WHERE user_id IN ${U})`;
  await c.query("BEGIN");
  await c.query(
    `DELETE FROM ride_offers WHERE ride_id IN (SELECT id FROM rides WHERE customer_id IN ${CU})`
  );
  await c
    .query(
      `DELETE FROM ride_events WHERE ride_id IN (SELECT id FROM rides WHERE customer_id IN ${CU})`
    )
    .catch(() => {});
  await c
    .query(
      `DELETE FROM ride_ledger WHERE ride_id IN (SELECT id FROM rides WHERE customer_id IN ${CU})`
    )
    .catch(() => {});
  await c.query(`DELETE FROM rides WHERE customer_id IN ${CU}`);
  await c
    .query(`DELETE FROM coligo_pay_payments WHERE customer_id IN ${CU}`)
    .catch(() => {});
  await c
    .query(`DELETE FROM coligo_pay_requests WHERE merchant_id IN ${M}`)
    .catch(() => {});
  await c.query(
    `DELETE FROM customer_wallet_entries WHERE customer_id IN ${CU}`
  );
  await c.query(
    `DELETE FROM orders WHERE merchant_id IN ${M} OR customer_id IN ${CU}`
  );
  await c.query(`DELETE FROM products WHERE merchant_id IN ${M}`);
  await c.query(`DELETE FROM chauffeur_presence WHERE chauffeur_id IN ${CH}`);
  await c.query(`DELETE FROM chauffeurs WHERE id IN ${CH}`);
  await c.query(`DELETE FROM merchants WHERE id IN ${M}`);
  await c.query(`DELETE FROM drivers WHERE user_id IN ${U}`);
  await c.query(`DELETE FROM customers WHERE id IN ${CU}`);
  await c.query(
    `DELETE FROM auth.users WHERE email LIKE '%@coligo-loadtest.dev'`
  );
  await c.query("COMMIT");
  await c.query("SET session_replication_role = origin").catch(() => {});
  const n = (
    await c.query(
      `SELECT count(*)::int n FROM auth.users WHERE email LIKE '%@coligo-loadtest.dev'`
    )
  ).rows[0].n;
  console.log(`✅ purge terminée · résidu auth.users = ${n}`);
} catch (e) {
  await c.query("ROLLBACK").catch(() => {});
  console.error("purge échec:", e.message);
} finally {
  await c.end();
}
