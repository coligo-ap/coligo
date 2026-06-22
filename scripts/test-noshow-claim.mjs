/**
 * Test transactionnel (ROLLBACK) du flux réclamation d'avance no-show (mig 0160) :
 *   1. crée une réclamation pending sur une commande livraison réelle ;
 *   2. la résout via admin_resolve_driver_refund_claim (driver_keeps) ;
 *   3. vérifie : claim approuvée + delivery_ledger driver_advance_refund +
 *      platform_ledger noshow_advance_expense (partie double, SUM = 0) ;
 *   4. re-résolution → already_resolved ; 5. rejet d'une 2e claim → rejected.
 * Tout est annulé (ROLLBACK) — aucune écriture ne reste en prod.
 */
import { getDbUrl } from "./_supabase.mjs";
import pg from "pg";

const c = new pg.Client({
  connectionString: getDbUrl(),
  ssl: { rejectUnauthorized: false },
});
await c.connect();

let pass = 0,
  fail = 0;
function check(label, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want);
  console.log(
    `${ok ? "✅" : "❌"} ${label}: got=${JSON.stringify(got)} want=${JSON.stringify(want)}`
  );
  ok ? pass++ : fail++;
}

try {
  await c.query("BEGIN");

  // Une commande livraison express réelle avec livreur (n'importe laquelle).
  const {
    rows: [o],
  } = await c.query(`
    SELECT o.id, o.delivery_driver_id, o.merchant_id, o.customer_id
      FROM public.orders o
     WHERE o.fulfillment_type = 'delivery' AND o.delivery_mode = 'express'
       AND o.delivery_driver_id IS NOT NULL
       AND NOT EXISTS (SELECT 1 FROM public.driver_refund_claims rc WHERE rc.order_id = o.id)
       AND NOT EXISTS (SELECT 1 FROM public.delivery_ledger dl
                        WHERE dl.order_id = o.id AND dl.type = 'driver_advance_refund')
     LIMIT 1`);
  if (!o) throw new Error("Aucune commande express avec livreur trouvée.");

  const ADV = 1900;
  const {
    rows: [claim],
  } = await c.query(
    `INSERT INTO public.driver_refund_claims (order_id, driver_id, merchant_id, customer_id, advance_da)
     VALUES ($1, $2, $3, $4, $5) RETURNING id`,
    [o.id, o.delivery_driver_id, o.merchant_id, o.customer_id, ADV]
  );

  // Approve « driver_keeps » → la plateforme rembourse via le ledger.
  const {
    rows: [r1],
  } = await c.query(
    `SELECT * FROM public.admin_resolve_driver_refund_claim($1, true, 'driver_keeps', 'test', 'test@coligo')`,
    [claim.id]
  );
  check("résolution ok", r1.ok, true);

  const {
    rows: [cl],
  } = await c.query(
    `SELECT status, goods_decision FROM public.driver_refund_claims WHERE id = $1`,
    [claim.id]
  );
  check("claim approuvée", cl.status, "approved");
  check("décision marchandise", cl.goods_decision, "driver_keeps");

  const {
    rows: [dl],
  } = await c.query(
    `SELECT amount_da FROM public.delivery_ledger WHERE order_id = $1 AND type = 'driver_advance_refund'`,
    [o.id]
  );
  check("delivery_ledger driver_advance_refund", dl?.amount_da, ADV);

  const {
    rows: [pl],
  } = await c.query(
    `SELECT amount_da FROM public.platform_ledger WHERE order_id = $1 AND type = 'noshow_advance_expense'`,
    [o.id]
  );
  check("platform_ledger noshow_advance_expense", pl?.amount_da, -ADV);
  check("partie double SUM=0", (dl?.amount_da ?? 0) + (pl?.amount_da ?? 0), 0);

  // Idempotence : re-résoudre → already_resolved.
  const {
    rows: [r2],
  } = await c.query(
    `SELECT * FROM public.admin_resolve_driver_refund_claim($1, true, 'give_away', null, null)`,
    [claim.id]
  );
  check("re-résolution refusée", r2.reason, "already_resolved");

  // Approve sans décision → goods_decision_required (claim séparée requise :
  // on réutilise la même via un reset local pour tester la garde).
  await c.query(
    `UPDATE public.driver_refund_claims SET status='pending', goods_decision=NULL WHERE id=$1`,
    [claim.id]
  );
  const {
    rows: [r3],
  } = await c.query(
    `SELECT * FROM public.admin_resolve_driver_refund_claim($1, true, NULL, NULL, NULL)`,
    [claim.id]
  );
  check("garde décision obligatoire", r3.reason, "goods_decision_required");

  // Rejet → rejected, aucune écriture supplémentaire.
  const {
    rows: [r4],
  } = await c.query(
    `SELECT * FROM public.admin_resolve_driver_refund_claim($1, false, NULL, 'suspicion abus', 'test@coligo')`,
    [claim.id]
  );
  check("rejet ok", r4.ok, true);
  const {
    rows: [cl2],
  } = await c.query(
    `SELECT status FROM public.driver_refund_claims WHERE id = $1`,
    [claim.id]
  );
  check("claim rejetée", cl2.status, "rejected");

  // Retour au commerçant : remboursement en MAIN PROPRE → aucune écriture ledger.
  await c.query(
    `UPDATE public.driver_refund_claims SET status='pending', goods_decision=NULL WHERE id=$1`,
    [claim.id]
  );
  await c.query(
    `DELETE FROM public.delivery_ledger WHERE order_id = $1 AND type = 'driver_advance_refund'`,
    [o.id]
  );
  // platform_ledger est append-only (mig 0243) — reset délibéré de scénario de
  // test : on ouvre l'échappatoire de maintenance le temps du DELETE.
  await c.query("SET app.ledger_maintenance = 'on'");
  await c.query(
    `DELETE FROM public.platform_ledger WHERE order_id = $1 AND type = 'noshow_advance_expense'`,
    [o.id]
  );
  await c.query("RESET app.ledger_maintenance");
  const {
    rows: [r5],
  } = await c.query(
    `SELECT * FROM public.admin_resolve_driver_refund_claim($1, true, 'return_to_merchant', NULL, NULL)`,
    [claim.id]
  );
  check("retour commerçant ok", r5.ok, true);
  const {
    rows: [{ count: nLedger }],
  } = await c.query(
    `SELECT count(*)::int AS count FROM public.delivery_ledger WHERE order_id = $1 AND type = 'driver_advance_refund'`,
    [o.id]
  );
  check("retour commerçant : AUCUNE écriture ledger", nLedger, 0);
} finally {
  await c.query("ROLLBACK");
  await c.end();
}

console.log(
  `\n${fail === 0 ? "🎉" : "💥"} no-show claims — pass=${pass} fail=${fail}`
);
process.exit(fail === 0 ? 0 : 1);
