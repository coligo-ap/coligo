// =============================================================================
// Test e2e (ROLLBACK) — plafond de dette ESPÈCES commerçant (mig 0269 + 0439).
// Depuis le durcissement RLS, TOUTES les commandes sont créées par le SERVEUR
// (service_role via createOrder) : le trigger s'applique à TOUS les rôles à la
// création (mig 0439 — l'ancienne exemption service_role le rendait mort).
// Prouve l'enforcement bypass-proof : dette > cap →
//   - commande CASH (retrait) bloquée sur le CHEMIN RÉEL (serveur) ;
//   - commande EN LIGNE permise (elle réduit la dette) ;
//   - commande CASH express COD permise (custodian livreur) ;
//   - cap 0 → politique désactivée (jamais bloqué).
// Lancer : node scripts/test-cash-debt-cap.mjs
// =============================================================================
import pg from "pg";
import { getDbUrl } from "./_supabase.mjs";

const MERCHANT = "6a57ea14-40e3-47c6-9fc8-305d8bbb5bdd";
const CUST = "60eec155-fb82-4a8b-9223-8ac2dd24d922";
const C_LAT = 36.7558,
  C_LNG = 5.07;

let pass = 0,
  fail = 0;
const okTrue = (label, cond) => {
  console.log(`${cond ? "✅" : "❌"} ${label}`);
  cond ? pass++ : fail++;
};

const c = new pg.Client({ connectionString: getDbUrl() });
await c.connect();
await c.query("BEGIN");

let spN = 0;
async function sp(fn) {
  const name = `sp${spN++}`;
  await c.query(`SAVEPOINT ${name}`);
  try {
    const r = await fn();
    await c.query(`RELEASE SAVEPOINT ${name}`);
    return { ok: true, rows: r?.rows };
  } catch (e) {
    await c.query(`ROLLBACK TO SAVEPOINT ${name}`);
    return { ok: false, err: e.message };
  }
}

// Insère une commande de test. kind : 'cash-pickup' | 'online-pickup' | 'cash-express'.
// pickup_code unique à chaque appel (évite toute collision d'unicité).
function insOrder(kind) {
  const isCash = kind !== "online-pickup";
  const isExpress = kind === "cash-express";
  const code = String(1000 + Math.floor(Math.random() * 9000));
  if (isExpress) {
    return c.query(
      `INSERT INTO orders (merchant_id,customer_id,customer_name,customer_phone,
         subtotal_da,discount_da,net_total_da,service_fee_da,delivery_fee_da,total_da,
         commission_da,pickup_code,pickup_slot_at,payment_method,payment_status,
         fulfillment_type,status,delivery_mode,delivery_lat,delivery_lng)
       VALUES ($1,$2,'T','+213770000000',1000,0,1000,50,200,1250,0,$5,now(),
         'cash','pending','delivery','pending','express',$3,$4) RETURNING id`,
      [MERCHANT, CUST, C_LAT, C_LNG, code]
    );
  }
  return c.query(
    `INSERT INTO orders (merchant_id,customer_id,customer_name,customer_phone,
       subtotal_da,discount_da,net_total_da,service_fee_da,delivery_fee_da,total_da,
       commission_da,pickup_code,pickup_slot_at,payment_method,payment_status,
       fulfillment_type,status)
     VALUES ($1,$2,'T','+213770000000',1000,0,1000,50,0,1050,0,$4,now(),
       $3,'pending','pickup','pending') RETURNING id`,
    [MERCHANT, CUST, isCash ? "cash" : "online", code]
  );
}

try {
  // Cap connu pour le test.
  await c.query(
    "UPDATE platform_settings SET max_debt_da = 5000 WHERE id = true"
  );
  // Neutralise le gate OPERATOR wallet (mig 0186) pour ISOLER notre trigger —
  // sinon le gros solde négatif du setup déclenche « indisponible (solde) ».
  await c.query(
    "UPDATE feature_flags SET status = 'hidden' WHERE key = 'operator_gating'"
  );

  // ── Cas NON bloqué (dette ramenée sous le cap via un gros crédit) ──
  await c.query(
    "INSERT INTO wallet_entries (merchant_id, type, amount_da, note) VALUES ($1,'adjustment',1000000,'TEST crédit')",
    [MERCHANT]
  );
  okTrue(
    "merchant_cash_blocked = false sous le cap",
    (await c.query("SELECT merchant_cash_blocked($1) b", [MERCHANT])).rows[0]
      .b === false
  );
  okTrue(
    "commande cash permise sous le cap (chemin serveur)",
    (await sp(() => insOrder("cash-pickup"))).ok
  );

  // ── Force la dette AU-DESSUS du cap ──
  await c.query(
    "INSERT INTO wallet_entries (merchant_id, type, amount_da, note) VALUES ($1,'adjustment',-1010000,'TEST dette')",
    [MERCHANT]
  );
  const debt = (await c.query("SELECT merchant_cash_debt($1) d", [MERCHANT]))
    .rows[0].d;
  okTrue(`dette espèces > cap (debt=${debt})`, debt >= 5000);
  okTrue(
    "merchant_cash_blocked = true au-dessus du cap",
    (await c.query("SELECT merchant_cash_blocked($1) b", [MERCHANT])).rows[0]
      .b === true
  );

  // ── Enforcement sur le CHEMIN RÉEL (créations serveur, mig 0439) ──
  const cashBlocked = await sp(() => insOrder("cash-pickup"));
  okTrue(
    "commande CASH retrait BLOQUÉE (trigger, chemin serveur)",
    !cashBlocked.ok && /merchant_cash_debt_cap/.test(cashBlocked.err || "")
  );
  okTrue(
    "commande EN LIGNE permise (réduit la dette)",
    (await sp(() => insOrder("online-pickup"))).ok
  );
  okTrue(
    "commande CASH express COD permise (custodian livreur)",
    (await sp(() => insOrder("cash-express"))).ok
  );

  // ── Politique désactivée (cap 0) ──
  await c.query("UPDATE platform_settings SET max_debt_da = 0 WHERE id = true");
  okTrue(
    "cap 0 → merchant_cash_blocked = false",
    (await c.query("SELECT merchant_cash_blocked($1) b", [MERCHANT])).rows[0]
      .b === false
  );
  okTrue(
    "cap 0 → commande cash permise malgré la dette",
    (await sp(() => insOrder("cash-pickup"))).ok
  );
} finally {
  await c.query("ROLLBACK");
  await c.end();
}

console.log(`\n${pass} ✅  ${fail} ❌`);
process.exit(fail ? 1 : 0);
