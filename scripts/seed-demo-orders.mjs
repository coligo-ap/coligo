/**
 * Crée 4 commandes EXPRESS en livraison pour le client de test qawaexpress,
 * avec 4 scénarios de paiement, chez 2 commerçants — pour observer le rendu
 * côté LIVREUR. Données RÉELLES (committées). Notes taguées [DEMO].
 *
 *   O1  Superette el sar (thefast) — cumulée, TOUT réglé → 0 DA à encaisser
 *   O2  Superette el sar          — espèces intégral → encaisse total
 *   O3  Boulangerie El Baraka (A) — payé EN LIGNE → 0 DA à encaisser
 *   O4  Boulangerie El Baraka (A) — cumulée partielle → reste en espèces
 */
import { getDbUrl } from "./_supabase.mjs";
import pg from "pg";

const CLIENT = { id: "c2debd28-082a-47f4-b21b-5364d7e6e470" };
const DRIVER = "cc7944e2-4ac3-4fcd-8bec-af29466f04d4";
const SUPERETTE = {
  id: "9192b8e4-31d3-4490-8c9e-0826cc2cdcd2",
  lat: 36.4557,
  lng: 4.5259,
};
const BOULANGERIE = {
  id: "6a57ea14-40e3-47c6-9fc8-305d8bbb5bdd",
  lat: 36.7558,
  lng: 5.07,
};

const ORDERS = [
  {
    tag: "O1 cumulée 0 DA",
    m: SUPERETTE,
    subtotal: 1000,
    delivery: 250,
    cashback: 250,
    topup: 1000,
    method: "cash",
    paid: false,
  },
  {
    tag: "O2 espèces intégral",
    m: SUPERETTE,
    subtotal: 1200,
    delivery: 250,
    cashback: 0,
    topup: 0,
    method: "cash",
    paid: false,
  },
  {
    tag: "O3 en ligne payé",
    m: BOULANGERIE,
    subtotal: 1800,
    delivery: 300,
    cashback: 0,
    topup: 0,
    method: "online",
    paid: true,
  },
  {
    tag: "O4 cumulée + reste espèces",
    m: BOULANGERIE,
    subtotal: 2000,
    delivery: 300,
    cashback: 500,
    topup: 800,
    method: "cash",
    paid: false,
  },
];

const c = new pg.Client({
  connectionString: getDbUrl(),
  ssl: { rejectUnauthorized: false },
});
const q = async (s, p) => (await c.query(s, p)).rows;

(async () => {
  await c.connect();
  await c.query("BEGIN");
  try {
    const phone =
      (await q("SELECT phone FROM customers WHERE id=$1", [CLIENT.id]))[0]
        ?.phone || "0600000000";
    const name =
      (await q("SELECT full_name FROM customers WHERE id=$1", [CLIENT.id]))[0]
        ?.full_name || "Client";

    // 1) Crédit cashback (pour couvrir les commandes cumulées) — réel.
    const cbNeeded = ORDERS.reduce((s, o) => s + o.cashback, 0);
    if (cbNeeded > 0) {
      await c.query(
        `INSERT INTO customer_wallet_entries (customer_id, type, source, amount_da, note)
         VALUES ($1,'cashback_earned','cashback',$2,'[DEMO] crédit cashback pour test livraison')`,
        [CLIENT.id, cbNeeded + 50]
      );
    }
    const cb = (
      await q("SELECT customer_cashback_balance($1) b", [CLIENT.id])
    )[0].b;
    const tp = (await q("SELECT customer_topup_balance($1) b", [CLIENT.id]))[0]
      .b;
    console.log(`Soldes client → cashback=${cb} · coligo_pay=${tp}`);

    // 2) Rattache le livreur à « Commerçant A » (Boulangerie) pour qu'il le voie.
    await c.query(
      `INSERT INTO merchant_drivers (merchant_id, driver_id, status)
       VALUES ($1,$2,'active')
       ON CONFLICT (merchant_id, driver_id) DO UPDATE SET status='active'`,
      [BOULANGERIE.id, DRIVER]
    );

    // 3) Crée les 4 commandes.
    console.log("\nCommandes créées :");
    for (const o of ORDERS) {
      const total = o.subtotal + o.delivery - o.cashback - o.topup; // = à encaisser si cash
      const row = (
        await q(
          `INSERT INTO orders
            (merchant_id, customer_id, customer_name, customer_phone, pickup_slot_at,
             fulfillment_type, delivery_mode, status, subtotal_da, delivery_fee_da,
             cashback_used_da, topup_used_da, total_da, payment_method, payment_status,
             delivery_lat, delivery_lng, delivery_address_text, delivery_phone, notes)
           VALUES ($1,$2,$3,$4, now(),
             'delivery','express','ready',$5,$6,$7,$8,$9,$10,$11,
             $12,$13,$14,$4,'[DEMO] '||$15)
           RETURNING id, order_number, pickup_code, total_da`,
          [
            o.m.id,
            CLIENT.id,
            name,
            phone,
            o.subtotal,
            o.delivery,
            o.cashback,
            o.topup,
            total,
            o.method,
            o.paid ? "paid" : "pending",
            o.m.lat + 0.012,
            o.m.lng + 0.012,
            "Cité Test, près du commerçant",
            o.tag,
          ]
        )
      )[0];
      const collect = o.method === "online" ? 0 : total;
      const prepaid = o.method === "online" || o.cashback > 0 || o.topup > 0;
      console.log(
        `  • ${o.tag.padEnd(28)} #${row.order_number ?? row.id.slice(0, 6)} ` +
          `code=${row.pickup_code} | à encaisser=${collect} DA | ` +
          `prépayé=${prepaid ? "oui (code requis)" : "non (100% cash)"}`
      );
    }

    await c.query("COMMIT");
    console.log(
      "\n✅ 4 commandes créées (réelles). Côté livreur (Yaxine) : Superette el sar (2) + Boulangerie El Baraka (2)."
    );
  } catch (e) {
    await c.query("ROLLBACK");
    console.error("ROLLBACK —", e.message);
    process.exitCode = 1;
  } finally {
    await c.end();
  }
})();
