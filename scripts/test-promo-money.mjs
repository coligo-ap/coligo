// =============================================================================
// Tests de non-régression — PROMOS / argent (PARTIE B)
// =============================================================================
// Vérifie, contre la VRAIE logique de prod (triggers Postgres) :
//   A. COMMISSION SUR LE NET   — la commission se calcule sur net_total_da
//      (montant APRÈS promo), PAS sur subtotal − discount.
//   B. SNAPSHOT IMMUABLE       — gross/net/financeur figés à la création,
//      commission_da figée à la complétion = round(net × taux).
//   C. SUM = 0 (grand livre)   — la commission est comptabilisée
//      symétriquement (platform_ledger commission_income == −wallet_entries
//      commission) ; une promo ne crée AUCUN mouvement de wallet/ledger.
//
// A & B s'exécutent dans une transaction ROLLBACK (zéro pollution).
// C est en lecture seule sur les données réelles.
//
// Usage : node scripts/test-promo-money.mjs
// =============================================================================

import pg from "pg";
import { getDbUrl } from "./_supabase.mjs";

const client = new pg.Client({
  connectionString: getDbUrl(),
  ssl: { rejectUnauthorized: false },
});

let failures = 0;
function assert(cond, label, detail) {
  if (cond) {
    console.log(`  ✅ ${label}`);
  } else {
    failures++;
    console.error(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

const round = (n) => Math.round(n);

async function main() {
  await client.connect();

  // Cible : un commerçant actif + un client réels (pour les FK).
  const mer = await client.query(
    "select id from merchants where is_active = true order by created_at limit 1"
  );
  const cus = await client.query("select id from customers limit 1");
  if (!mer.rows[0] || !cus.rows[0]) {
    console.error("Pas de merchant/customer pour le test.");
    process.exit(1);
  }
  const merchantId = mer.rows[0].id;
  const customerId = cus.rows[0].id;
  const rateRes = await client.query(
    "select public.resolve_rate($1,'commission_cash')::float8 AS rate",
    [merchantId]
  );
  const commRate = Number(rateRes.rows[0].rate);
  console.log(`Merchant ${merchantId} · taux commission cash = ${commRate}\n`);

  // ===========================================================================
  // TESTS A & B — dans une transaction annulée à la fin.
  // ===========================================================================
  console.log("TEST A — Commission calculée sur le NET (après promo)");
  console.log("TEST B — Snapshot immuable (gross/net/financeur/commission)");

  // Valeurs choisies pour que subtotal − discount (= 1300) DIFFÈRE du net
  // (= 1000). Si le trigger se trompait de base, la commission vaudrait
  // round(1300 × taux) au lieu de round(1000 × taux).
  const GROSS = 1500; // prix produits AVANT promo
  const SUBTOTAL = 1300; // somme des lignes après réductions produit
  const DISCOUNT = 300; // code promo seul
  const NET = 1000; // = SUBTOTAL − DISCOUNT = base commission attendue
  const SERVICE = 50;
  const TOTAL = NET + SERVICE; // cash, sans livraison ni wallet
  const expectedCommission = round(NET * commRate);
  const wrongCommission = round((SUBTOTAL - 0) * commRate); // si base erronée

  await client.query("BEGIN");
  try {
    const ins = await client.query(
      `INSERT INTO public.orders
         (merchant_id, customer_id, customer_name, customer_phone, status,
          payment_method, payment_status, pickup_type, pickup_slot_at,
          pickup_code, subtotal_da, discount_da, gross_total_da, net_total_da,
          promo_financeur, total_da, service_fee_da, commission_da)
       VALUES ($1,$2,'TEST PROMO','+213000000000','pending',
          'cash','pending','asap', now() + interval '30 min',
          'TST000', $3,$4,$5,$6,'merchant',$7,$8,0)
       RETURNING id`,
      [merchantId, customerId, SUBTOTAL, DISCOUNT, GROSS, NET, TOTAL, SERVICE]
    );
    const orderId = ins.rows[0].id;

    // Snapshot à la création.
    const created = await client.query(
      "select gross_total_da, net_total_da, promo_financeur, discount_da, subtotal_da from public.orders where id=$1",
      [orderId]
    );
    const c0 = created.rows[0];
    assert(
      c0.gross_total_da === GROSS &&
        c0.net_total_da === NET &&
        c0.promo_financeur === "merchant",
      "B1 snapshot gross/net/financeur figé à la création",
      JSON.stringify(c0)
    );

    // Complétion → déclenche le trigger wallet.
    await client.query(
      "update public.orders set status='completed' where id=$1",
      [orderId]
    );

    const we = await client.query(
      "select type, amount_da from public.wallet_entries where order_id=$1",
      [orderId]
    );
    const pl = await client.query(
      "select type, amount_da from public.platform_ledger where order_id=$1",
      [orderId]
    );
    const ord = await client.query(
      "select commission_da from public.orders where id=$1",
      [orderId]
    );
    const walletComm = we.rows.find((r) => r.type === "commission");
    const ledgerComm = pl.rows.find((r) => r.type === "commission_income");

    assert(
      walletComm && Math.abs(walletComm.amount_da) === expectedCommission,
      `A1 commission wallet = round(NET × taux) = ${expectedCommission}`,
      `obtenu ${walletComm?.amount_da}`
    );
    assert(
      walletComm && Math.abs(walletComm.amount_da) !== wrongCommission,
      `A2 commission ≠ base erronée (subtotal) = ${wrongCommission}`,
      `obtenu ${walletComm?.amount_da}`
    );
    assert(
      ledgerComm && ledgerComm.amount_da === expectedCommission,
      `A3 platform_ledger commission_income = ${expectedCommission}`,
      `obtenu ${ledgerComm?.amount_da}`
    );
    assert(
      ord.rows[0].commission_da === expectedCommission,
      `B2 orders.commission_da figée = ${expectedCommission}`,
      `obtenu ${ord.rows[0].commission_da}`
    );

    // SUM = 0 sur la commission de CETTE commande (symétrie double-entrée).
    assert(
      walletComm &&
        ledgerComm &&
        walletComm.amount_da + ledgerComm.amount_da === 0,
      "C0 commission booked SUM=0 (wallet + ledger = 0)",
      `${walletComm?.amount_da} + ${ledgerComm?.amount_da}`
    );

    // Une promo ne crée AUCUN type d'entrée 'discount'/'promo' dans les ledgers.
    const allTypes = [...we.rows, ...pl.rows].map((r) => r.type);
    assert(
      !allTypes.some((t) => /promo|discount|reduction/i.test(t)),
      "C1 aucune écriture wallet/ledger de type promo/discount",
      allTypes.join(",")
    );
  } finally {
    await client.query("ROLLBACK");
  }

  // ===========================================================================
  // TEST C — SUM=0 sur les données RÉELLES (lecture seule).
  // ===========================================================================
  console.log("\nTEST C — Intégrité grand livre sur commandes réelles");

  // Balance GLOBALE : la commission encaissée par Coligo (platform_ledger) doit
  // exactement compenser la commission débitée au commerçant (wallet_entries).
  // Couvre aussi les écritures orphelines (order_id NULL).
  const glob = await client.query(`
    SELECT
      (SELECT COALESCE(SUM(amount_da),0) FROM public.wallet_entries WHERE type='commission')
      + (SELECT COALESCE(SUM(amount_da),0) FROM public.platform_ledger WHERE type='commission_income')
      AS global_sum
  `);
  assert(
    Number(glob.rows[0].global_sum) === 0,
    "C2 commission globale SUM=0 (wallet + ledger = 0)",
    `global=${glob.rows[0].global_sum}`
  );

  // Symétrie PAR COMMANDE (entrées rattachées à une commande). NULL order_id =
  // écritures manuelles/seed, couvertes par la balance globale ci-dessus.
  const sym = await client.query(`
    WITH wc AS (
      SELECT order_id, SUM(amount_da) amt FROM public.wallet_entries
      WHERE type='commission' AND order_id IS NOT NULL GROUP BY order_id
    ),
    pc AS (
      SELECT order_id, SUM(amount_da) amt FROM public.platform_ledger
      WHERE type='commission_income' AND order_id IS NOT NULL GROUP BY order_id
    )
    SELECT count(*) FILTER (WHERE COALESCE(wc.amt,0) + COALESCE(pc.amt,0) <> 0) AS bad,
           count(*) AS total
    FROM wc FULL OUTER JOIN pc ON wc.order_id = pc.order_id
  `);
  assert(
    Number(sym.rows[0].bad) === 0,
    `C2b commission symétrique par commande sur ${sym.rows[0].total} commandes`,
    `${sym.rows[0].bad} asymétries`
  );

  // service_fee encaissé en espèces : wallet service_fee == −platform service_fee_income.
  const svc = await client.query(`
    WITH ws AS (
      SELECT order_id, SUM(amount_da) amt FROM public.wallet_entries
      WHERE type='service_fee' GROUP BY order_id
    ),
    ps AS (
      SELECT pl.order_id, SUM(pl.amount_da) amt FROM public.platform_ledger pl
      JOIN public.orders o ON o.id=pl.order_id
      WHERE pl.type='service_fee_income' AND o.payment_method='cash'
      GROUP BY pl.order_id
    )
    SELECT count(*) FILTER (WHERE COALESCE(ws.amt,0) + COALESCE(ps.amt,0) <> 0) AS bad,
           count(*) AS total
    FROM ws FULL OUTER JOIN ps ON ws.order_id = ps.order_id
  `);
  assert(
    Number(svc.rows[0].bad) === 0,
    `C3 frais de service cash symétriques sur ${svc.rows[0].total} commandes`,
    `${svc.rows[0].bad} asymétries`
  );

  // Cohérence du snapshot sur d'éventuelles commandes avec promo : net ≤ gross.
  const snap = await client.query(`
    SELECT count(*) FILTER (
      WHERE gross_total_da IS NOT NULL AND net_total_da IS NOT NULL
        AND net_total_da > gross_total_da
    ) AS bad,
    count(*) FILTER (WHERE promo_id IS NOT NULL) AS promo_orders
    FROM public.orders
  `);
  assert(
    Number(snap.rows[0].bad) === 0,
    `C4 snapshot net ≤ gross (commandes promo: ${snap.rows[0].promo_orders})`,
    `${snap.rows[0].bad} incohérences`
  );

  await client.end();

  console.log(
    `\n${failures === 0 ? "✅ TOUS LES TESTS PASSENT" : `❌ ${failures} test(s) en échec`}`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
