// TEST — cashback sur no-show (mig 0291). Flux RÉEL driver_report_no_show.
//   • ONLINE prépayé + client absent → le client GARDE son cashback.
//   • ESPÈCES + client absent       → 0 cashback (règle Yassir, pénalisé).
// Transaction ROLLBACK.
import pg from "pg";
import { getDbUrl } from "./_supabase.mjs";

const c = new pg.Client({ connectionString: getDbUrl() });
await c.connect();
await c.query("BEGIN");

const M_USER = "11111111-aaaa-1111-1111-111111111111";
const C_USER = "22222222-aaaa-2222-2222-222222222222";
const D_USER = "33333333-aaaa-3333-3333-333333333333";
const q1 = async (s, p = []) => (await c.query(s, p)).rows[0];
const cashback = async (id) =>
  (await q1("SELECT public.customer_cashback_balance($1)::int s", [id])).s;
let pass = 0,
  fail = 0;
const check = (label, cond, extra = "") => {
  console.log(
    `  ${cond ? "✅" : "❌"} ${label}${extra ? "  (" + extra + ")" : ""}`
  );
  cond ? pass++ : fail++;
};

try {
  for (const [id, email] of [
    [M_USER, "noshow-m@test.local"],
    [C_USER, "noshow-c@test.local"],
    [D_USER, "noshow-d@test.local"],
  ])
    await c.query(
      `INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
       VALUES ('00000000-0000-0000-0000-000000000000',$1,'authenticated','authenticated',$2,'x',now(),now(),now())`,
      [id, email]
    );
  const M = (
    await q1(
      "INSERT INTO merchants (user_id,name,slug,is_active) VALUES ($1,'M no-show','m-noshow',true) RETURNING id",
      [M_USER]
    )
  ).id;
  const C = (
    await q1(
      "INSERT INTO customers (user_id,full_name) VALUES ($1,'C no-show') RETURNING id",
      [C_USER]
    )
  ).id;
  const D = (
    await q1(
      "INSERT INTO drivers (user_id,full_name,phone) VALUES ($1,'D no-show','+213700000077') RETURNING id",
      [D_USER]
    )
  ).id;

  async function noShowScenario(label, { method }) {
    const P = 1000,
      S = 50,
      Dfee = 200;
    const total = P + S + Dfee;
    const paid = method === "cash" ? "pending" : "paid";
    const o = (
      await q1(
        `INSERT INTO orders (merchant_id, customer_id, customer_name, customer_phone,
           subtotal_da, discount_da, net_total_da, service_fee_da, delivery_fee_da, total_da,
           pickup_code, pickup_slot_at, payment_method, payment_status, fulfillment_type,
           delivery_mode, delivery_driver_id, delivery_lat, delivery_lng, delivery_address_text,
           delivery_picked_up_at, delivery_arrived_at, status)
         VALUES ($1,$2,'C no-show','+213770000001',$3,0,$3,$4,$5,$6,'7777',now(),$7,$8,'delivery',
           'express',$9,36.75,5.06,'Adresse', now() - interval '1 day', now() - interval '1 day', 'preparing')
         RETURNING id`,
        [M, C, P, S, Dfee, total, method, paid, D]
      )
    ).id;

    const cbBefore = await cashback(C);

    // impersonation livreur → appel RÉEL de la RPC
    await c.query(
      `SELECT set_config('request.jwt.claims', json_build_object('sub','${D_USER}','role','authenticated')::text, true)`
    );
    const r = await q1("SELECT * FROM driver_report_no_show($1,'no_show',$2)", [
      o,
      "op-" + method,
    ]);
    await c.query(`SELECT set_config('request.jwt.claims','',true)`);

    const cbAfter = await cashback(C);
    const ord = await q1(
      "SELECT status, delivery_failed_at, cashback_da FROM orders WHERE id=$1",
      [o]
    );
    const cbEarned = (
      await q1(
        "SELECT COALESCE(SUM(amount_da),0)::int s FROM customer_wallet_entries WHERE order_id=$1 AND type='cashback_earned'",
        [o]
      )
    ).s;
    const platCb = (
      await q1(
        "SELECT COALESCE(SUM(amount_da),0)::int s FROM platform_ledger WHERE order_id=$1 AND type='cashback_expense'",
        [o]
      )
    ).s;

    console.log(`\n━━━ ${label} ━━━`);
    console.log(`   RPC ok=${r.ok} reason=${r.reason}`);
    console.log(
      `   statut=${ord.status}  delivery_failed=${ord.delivery_failed_at ? "oui" : "non"}  cashback_da=${ord.cashback_da}`
    );
    console.log(
      `   cashback client : ${cbBefore} → ${cbAfter}  | crédit client=${cbEarned}  charge plateforme=${platCb}`
    );
    return { ord, cbEarned, platCb, delta: cbAfter - cbBefore };
  }

  // 1) ONLINE prépayé → cashback CONSERVÉ
  const on = await noShowScenario("ONLINE prépayé, client absent", {
    method: "online",
  });
  const expected = Math.round((1000 + 200) * 0.03); // (produits+livraison)×3% = 36
  check(
    "commande bien en no-show (cancelled + failed)",
    on.ord.status === "cancelled" && on.ord.delivery_failed_at
  );
  check(
    `client gagne son cashback = ${expected}`,
    on.delta === expected && on.cbEarned === expected,
    `delta=${on.delta}`
  );
  check(
    "paire symétrique : charge plateforme = −crédit client",
    on.platCb === -on.cbEarned,
    `plat=${on.platCb}`
  );

  // 2) ESPÈCES → AUCUN cashback GAGNÉ (et pénalité existante = récupération de la
  //    livraison sur le solde cashback du client, règle Yassir 0162 — attendu).
  const cash = await noShowScenario("ESPÈCES, client absent", {
    method: "cash",
  });
  check(
    "aucun cashback GAGNÉ en espèces",
    cash.cbEarned === 0 && cash.ord.cashback_da === 0,
    `crédit=${cash.cbEarned}`
  );
  check("pas de charge cashback plateforme en espèces", cash.platCb === 0);

  console.log(`\n=============================================`);
  console.log(`  RÉSULTAT : ${pass} ✅   ${fail} ❌`);
  console.log(`=============================================`);
} catch (e) {
  console.error("\n❌ ERREUR:", e.message);
  console.error(e.stack);
  fail++;
} finally {
  await c.query("ROLLBACK");
  await c.end();
  console.log("(ROLLBACK — rien persisté)");
  process.exit(fail ? 1 : 0);
}
