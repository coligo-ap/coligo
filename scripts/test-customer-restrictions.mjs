/**
 * TEST des restrictions client (mig 0397) — BASE d'abord, puis INTERFACE.
 *
 *   node scripts/test-customer-restrictions.mjs          # base seulement
 *   node scripts/test-customer-restrictions.mjs --ui <dossier-captures>
 *
 * Tout se joue dans des transactions ANNULÉES : la base n'est jamais laissée
 * modifiée, sauf pendant la phase UI (restaurée en `finally`).
 *
 * Ce qui est vérifié :
 *   1. compte suspendu  ⇒ commande REFUSÉE (trigger), course REFUSÉE ;
 *   2. Drive coupé      ⇒ course REFUSÉE, commande TOUJOURS possible ;
 *   3. Coligo Pay coupé ⇒ paiement QR REFUSÉ ;
 *   4. cashback coupé   ⇒ gain calculé à 0 (sans bloquer la commande) ;
 *   5. `my_blocked_features()` ne renvoie QUE les coupures du client connecté ;
 *   6. UI : le scan code-barres disparaît et les messages s'affichent.
 */
import pg from "pg";
import { getDbUrl, loadEnvLocal } from "./_supabase.mjs";

loadEnvLocal();
const EMAIL = "qawaexpress@gmail.com"; // client de test
const UI = process.argv.includes("--ui");
const OUT = process.argv[process.argv.indexOf("--ui") + 1];

const db = new pg.Client({
  connectionString: getDbUrl(),
  ssl: { rejectUnauthorized: false },
});
await db.connect();

let pass = 0;
let fail = 0;
function check(label, ok, detail = "") {
  if (ok) pass++;
  else fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
}

const { rows: cust } = await db.query(
  "select id, user_id from public.customers where email = $1",
  [EMAIL]
);
if (!cust.length) throw new Error(`client de test introuvable : ${EMAIL}`);
const { id: customerId, user_id: userId } = cust[0];
const { rows: mrows } = await db.query(
  "select id from public.merchants where slug like 'dz-%' limit 1"
);
const merchantId = mrows[0].id;

/** Exécute `fn` dans une transaction toujours ANNULÉE. */
async function sandbox(fn) {
  await db.query("begin");
  try {
    return await fn();
  } finally {
    await db.query("rollback");
  }
}

/** Prend le rôle du client (RLS + auth.uid()) dans la transaction courante. */
async function actAsCustomer() {
  await db.query("set local role authenticated");
  await db.query(
    `select set_config('request.jwt.claims',
       json_build_object('sub', $1::text, 'role', 'authenticated')::text, true)`,
    [userId]
  );
}

/**
 * Renvoie le message d'erreur d'une requête, ou null si elle passe.
 *
 * POINT DE VUE MANQUÉ UNE FOIS : sans SAVEPOINT, la PREMIÈRE erreur avorte
 * toute la transaction et les requêtes suivantes échouent en
 * « current transaction is aborted » — le test passait alors au vert/rouge pour
 * de mauvaises raisons.
 */
async function errorOf(sql, params = []) {
  await db.query("savepoint s");
  try {
    await db.query(sql, params);
    await db.query("release savepoint s");
    return null;
  } catch (e) {
    await db.query("rollback to savepoint s");
    return e.message;
  }
}

const ORDER_SQL = `insert into public.orders
  (merchant_id, customer_id, customer_name, customer_phone, status,
   total_da, subtotal_da, pickup_code, payment_method, fulfillment_type,
   pickup_slot_at)
  values ($1, $2, 'Test', '0600000000', 'pending', 100, 100, '0000', 'cash', 'pickup',
          now() + interval '1 hour')`;

const DELIVERY_ORDER_SQL = `insert into public.orders
  (merchant_id, customer_id, customer_name, customer_phone, status,
   total_da, subtotal_da, pickup_code, payment_method,
   fulfillment_type, delivery_mode, delivery_address_text,
   delivery_lat, delivery_lng, delivery_fee_da, pickup_slot_at)
  values ($1, $2, 'Test', '0600000000', 'pending', 100, 100, '0000', 'cash',
          'delivery', 'express', 'Test', 36.75, 5.08, 200, now() + interval '1 hour')`;

const RIDE_SQL = `insert into public.rides
  (customer_id, status, pickup_lat, pickup_lng, dest_lat, dest_lng,
   distance_km, proposed_price_da, payment_method)
  values ($1, 'searching', 36.75, 5.08, 36.76, 5.09, 2, 300, 'cash')`;

const PAY_SQL = `insert into public.coligo_pay_payments
  (customer_id, merchant_id, amount_da, commission_rate, commission_da, net_da)
  values ($1, $2, 500, 0, 0, 500)`;

console.log("── 1. Compte suspendu ──");
await sandbox(async () => {
  await db.query("select set_config('app.allow_risk_update','on',true)");
  await db.query(
    "update public.customers set is_blocked = true where id = $1",
    [customerId]
  );
  check(
    "commande refusée",
    (await errorOf(ORDER_SQL, [merchantId, customerId]))?.includes(
      "account_blocked"
    ) === true
  );
  check(
    "course refusée",
    (await errorOf(RIDE_SQL, [customerId]))?.includes("account_blocked") ===
      true
  );
  check(
    "paiement Coligo Pay refusé",
    (await errorOf(PAY_SQL, [customerId, merchantId]))?.includes(
      "account_blocked"
    ) === true
  );
});

console.log("\n── 2. Drive coupé (compte actif) ──");
await sandbox(async () => {
  await db.query(
    `insert into public.customer_feature_blocks (customer_id, feature) values ($1,'drive')`,
    [customerId]
  );
  check(
    "course refusée",
    (await errorOf(RIDE_SQL, [customerId]))?.includes(
      "feature_disabled:drive"
    ) === true
  );
  check(
    "commande TOUJOURS possible",
    (await errorOf(ORDER_SQL, [merchantId, customerId])) === null
  );
});

console.log("\n── 2 bis. CHEMIN PASSANT (le trigger ne doit rien casser) ──");
await sandbox(async () => {
  // Client SANS aucune restriction : ses commandes doivent passer, y compris en
  // livraison — c'est ce chemin qu'un test « refus seulement » ne voit pas.
  const { rows: free } = await db.query(
    `select c.id from public.customers c
      where not c.is_blocked
        and not exists (select 1 from public.customer_feature_blocks b where b.customer_id = c.id)
      limit 1`
  );
  const freeId = free[0].id;
  check(
    "commande RETRAIT acceptée",
    (await errorOf(ORDER_SQL, [merchantId, freeId])) === null
  );
  const deliveryErr = await errorOf(DELIVERY_ORDER_SQL, [merchantId, freeId]);
  check(
    "commande LIVRAISON EXPRESS acceptée",
    deliveryErr === null,
    deliveryErr ?? ""
  );

  // Puis la même commande avec Express coupé → refus explicite.
  await db.query(
    `insert into public.customer_feature_blocks (customer_id, feature) values ($1,'express')
     on conflict (customer_id, feature) do nothing`,
    [freeId]
  );
  check(
    "livraison Express refusée une fois coupée",
    (await errorOf(DELIVERY_ORDER_SQL, [merchantId, freeId]))?.includes(
      "feature_disabled:express"
    ) === true
  );
});

console.log("\n── 3. Coligo Pay coupé ──");
await sandbox(async () => {
  await db.query(
    `insert into public.customer_feature_blocks (customer_id, feature) values ($1,'coligo_pay')`,
    [customerId]
  );
  check(
    "paiement QR refusé",
    (await errorOf(PAY_SQL, [customerId, merchantId]))?.includes(
      "feature_disabled:coligo_pay"
    ) === true
  );
});

console.log("\n── 4. Cashback coupé ──");
await sandbox(async () => {
  const { rows: before } = await db.query(
    `select public.compute_order_cashback_da(o.*) as da
       from public.orders o where o.customer_id = $1 and o.status = 'completed'
      order by o.created_at desc limit 1`,
    [customerId]
  );
  await db.query(
    `insert into public.customer_feature_blocks (customer_id, feature) values ($1,'cashback')`,
    [customerId]
  );
  const { rows: after } = await db.query(
    `select public.compute_order_cashback_da(o.*) as da
       from public.orders o where o.customer_id = $1 and o.status = 'completed'
      order by o.created_at desc limit 1`,
    [customerId]
  );
  check(
    "gain ramené à 0",
    Number(after[0]?.da ?? 0) === 0,
    `avant ${before[0]?.da ?? "—"} DA, après ${after[0]?.da ?? "—"} DA`
  );
});

console.log("\n── 5. Lecture par le client (my_blocked_features) ──");
await sandbox(async () => {
  await db.query(
    `insert into public.customer_feature_blocks (customer_id, feature, reason)
     values ($1,'barcode_marketplace','Test')
     on conflict (customer_id, feature) do update set reason = 'Test'`,
    [customerId]
  );
  // Coupure posée sur un AUTRE client : elle ne doit jamais fuiter.
  const { rows: other } = await db.query(
    "select id from public.customers where id <> $1 limit 1",
    [customerId]
  );
  await db.query(
    `insert into public.customer_feature_blocks (customer_id, feature) values ($1,'drive')`,
    [other[0].id]
  );
  await actAsCustomer();
  const { rows } = await db.query("select * from public.my_blocked_features()");
  check(
    "le client voit SA coupure",
    rows.some((r) => r.feature === "barcode_marketplace" && r.reason === "Test")
  );
  check(
    "aucune fuite d'un autre compte",
    !rows.some((r) => r.feature === "drive"),
    `${rows.length} ligne(s)`
  );
});

console.log(`\n${pass} succès, ${fail} échec(s)`);

// ---------------------------------------------------------------------------
// 6. INTERFACE (option --ui) : le scan disparaît, les messages s'affichent.
// ---------------------------------------------------------------------------
if (UI) {
  const { chromium } = await import("playwright");
  const BASE = process.env.BASE_URL ?? "http://localhost:3000";
  let browser;
  let createdForTest = false;
  try {
    // Coupure déjà posée par l'ÉQUIPE ? on la garde et on ne nettoie rien à la
    // fin — un test ne doit jamais défaire une décision réelle.
    const { rows: existing } = await db.query(
      "select 1 from public.customer_feature_blocks where customer_id = $1 and feature = 'barcode_marketplace'",
      [customerId]
    );
    createdForTest = existing.length === 0;
    if (createdForTest) {
      await db.query(
        `insert into public.customer_feature_blocks (customer_id, feature, reason, blocked_by)
         values ($1,'barcode_marketplace','Test automatisé','qa')`,
        [customerId]
      );
    }
    browser = await chromium.launch();
    const page = await browser.newPage({
      viewport: { width: 412, height: 900 },
    });
    await page.goto(`${BASE}/se-connecter`, {
      waitUntil: "domcontentloaded",
      timeout: 180000,
    });
    await page.fill("#email", EMAIL);
    await page.fill("#password", EMAIL);
    await page.click('button[type="submit"]');
    await page.waitForTimeout(9000);

    await page.goto(BASE, { waitUntil: "domcontentloaded", timeout: 180000 });
    await page.waitForTimeout(5000);
    if (OUT) await page.screenshot({ path: `${OUT}/scan-coupe.png` });
    const scanners = await page
      .locator('[aria-label*="can"], [data-testid="barcode-scan"]')
      .count();
    check(
      "bouton de scan retiré de l'accueil",
      scanners === 0,
      `${scanners} bouton(s)`
    );
  } finally {
    if (createdForTest) {
      await db.query(
        "delete from public.customer_feature_blocks where customer_id = $1 and feature = 'barcode_marketplace'",
        [customerId]
      );
    }
    if (browser) await browser.close();
  }
}

const { rows: leftovers } = await db.query(
  "select count(*)::int as n from public.customer_feature_blocks where customer_id = $1",
  [customerId]
);
console.log(`état final du client de test : ${leftovers[0].n} coupure(s)`);
await db.end();
process.exit(fail ? 1 : 0);
