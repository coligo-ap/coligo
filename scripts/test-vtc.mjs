// E2E VTC — cycle de vie complet (négociation → course → argent) via les VRAIS
// RPC, avec impersonation client/chauffeur. Transaction ROLLBACK.
import pg from "pg";
import { getDbUrl } from "./_supabase.mjs";

const CUST = "60eec155-fb82-4a8b-9223-8ac2dd24d922";
const CUST_USER = "00000000-0000-4000-8000-000820591480";
const CHU_USER = "11111111-1111-4111-8111-111111111111";

let pass = 0,
  fail = 0;
const ok = (l, g, w) => {
  const p = g === w;
  console.log(`${p ? "✅" : "❌"} ${l}: got=${g} want=${w}`);
  p ? pass++ : fail++;
};

const c = new pg.Client({ connectionString: getDbUrl() });
await c.connect();
await c.query("BEGIN");

const asCust = () =>
  c.query(
    `SELECT set_config('request.jwt.claims', json_build_object('sub','${CUST_USER}','role','authenticated')::text, true)`
  );
const asChu = () =>
  c.query(
    `SELECT set_config('request.jwt.claims', json_build_object('sub','${CHU_USER}','role','authenticated')::text, true)`
  );
const rl = async (rideId, type) =>
  (
    await c.query(
      "SELECT COALESCE(SUM(amount_da),0)::int s FROM ride_ledger WHERE ride_id=$1 AND type=$2",
      [rideId, type]
    )
  ).rows[0].s;
const plat = async () =>
  (
    await c.query(
      "SELECT COALESCE(SUM(amount_da),0)::int s FROM platform_ledger WHERE type='vtc_commission_income' AND order_id IS NULL"
    )
  ).rows[0].s;

async function lifecycle(payment, offerPrice) {
  await asCust();
  const ride = (
    await c.query(
      "SELECT request_ride(36.75,3.06,'Départ',36.78,3.10,'Arrivée',5.0,$1,$2) id",
      [0, payment]
    )
  ).rows[0].id;
  const r0 = (
    await c.query(
      "SELECT status, suggested_price_da, proposed_price_da FROM rides WHERE id=$1",
      [ride]
    )
  ).rows[0];
  console.log(
    `\n=== Course ${payment} | prix suggéré=${r0.suggested_price_da} proposé=${r0.proposed_price_da} ===`
  );

  // Chauffeur contre-propose offerPrice
  await asChu();
  const off = await c.query("SELECT * FROM chauffeur_offer_ride($1,$2)", [
    ride,
    offerPrice,
  ]);
  ok("offre chauffeur acceptée", off.rows[0].ok, true);

  // Client choisit l'offre
  await asCust();
  const offerId = (
    await c.query("SELECT id FROM ride_offers WHERE ride_id=$1 LIMIT 1", [ride])
  ).rows[0].id;
  const acc = await c.query("SELECT * FROM accept_ride_offer($1)", [offerId]);
  ok("offre choisie par le client", acc.rows[0].ok, true);
  const agreed = (
    await c.query("SELECT agreed_price_da, status FROM rides WHERE id=$1", [
      ride,
    ])
  ).rows[0];
  ok("prix convenu = offre", agreed.agreed_price_da, offerPrice);

  // Chauffeur : en route → arrivé → PIN du client → à bord → terminé.
  // Mig 0145 : le CODE PIN (4 chiffres) valide le DÉMARRAGE des courses en
  // ligne (séquestre) ; la complétion libère le séquestre sans code.
  await asChu();
  await c.query("SELECT ride_set_status($1,'arriving')", [ride]);
  await c.query("SELECT ride_set_status($1,'arrived')", [ride]);
  const pin = (await c.query("SELECT end_code FROM rides WHERE id=$1", [ride]))
    .rows[0].end_code;
  await c.query("SELECT ride_set_status($1,'in_progress',$2)", [ride, pin]);
  const comp = await c.query("SELECT * FROM complete_ride($1)", [ride]);
  ok("course terminée", comp.rows[0].ok, true);

  const F = offerPrice,
    c8 = Math.round(F * 0.08),
    net = F - c8;
  if (payment === "cash") {
    ok("cash_collected = F", await rl(ride, "chauffeur_cash_collected"), F);
    ok(
      "owes_platform = commission(8%)",
      await rl(ride, "chauffeur_owes_platform"),
      c8
    );
    ok("payout = F − commission", await rl(ride, "chauffeur_payout"), net);
    const residu =
      (await rl(ride, "chauffeur_cash_collected")) -
      (await rl(ride, "chauffeur_owes_platform")) -
      (await rl(ride, "chauffeur_payout"));
    ok("RÉSIDU chauffeur custodian = 0", residu, 0);
  }
  return { ride, F, c8, net };
}

try {
  // Chauffeur de test (vérifié).
  await c.query(
    "INSERT INTO chauffeurs (user_id, full_name, phone, is_verified, vehicle_plate) VALUES ($1,'Karim VTC','+213700000999',true,'00123-114-16')",
    [CHU_USER]
  );

  // --- Course ESPÈCES : suggéré 250 (base100+5×30), chauffeur contre à 300 ---
  await lifecycle("cash", 300);

  // --- Course COLIGO PAY : client crédité 500, course à 280 ---
  await c.query(
    "INSERT INTO customer_wallet_entries (customer_id,type,source,amount_da,note) VALUES ($1,'topup_credit','topup',500,'seed')",
    [CUST]
  );
  const balBefore = (
    await c.query("SELECT customer_topup_balance($1) v", [CUST])
  ).rows[0].v;
  const { ride, F, c8, net } = await lifecycle("coligo_pay", 280);
  const balAfter = (
    await c.query("SELECT customer_topup_balance($1) v", [CUST])
  ).rows[0].v;
  ok("client débité de F sur Coligo Pay", balBefore - balAfter, F);
  ok(
    "payout chauffeur = F − commission",
    await rl(ride, "chauffeur_payout"),
    net
  );
  ok("platform_ledger vtc_commission_income = commission", await plat(), c8);
  // Réconciliation globale : −F (client) + net (chauffeur) + c (plateforme) = 0
  ok(
    "CONSERVATION Coligo Pay (−F + net + c = 0)",
    -(balBefore - balAfter) + net + c8,
    0
  );

  console.log(
    `\n${fail === 0 ? "🎉 VTC SOCLE OK" : "⚠️ ÉCHECS"} — pass=${pass} fail=${fail}`
  );
} catch (e) {
  console.error("ERREUR:", e.message);
  fail++;
} finally {
  await c.query("ROLLBACK");
  await c.end();
}
process.exit(fail === 0 ? 0 : 1);
