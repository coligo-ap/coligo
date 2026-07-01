// =============================================================================
// Plans d'abonnement Drive (0304) — SÉCURITÉ anti-altération + résolution.
// Prouve : (1) un authenticated ne peut PAS écrire un plan (RLS+grants+trigger) ;
// (2) drive_subscribe IMPOSE le prix de la table (le chauffeur ne fournit aucun
// prix) ; (3) resolve_drive_plan/cashback reflètent le plan. Transaction ROLLBACK.
// =============================================================================
import pg from "pg";
import { getDbUrl } from "./_supabase.mjs";

const c = new pg.Client({
  connectionString: getDbUrl(),
  ssl: { rejectUnauthorized: false },
});
await c.connect();
let pass = 0,
  fail = 0;
const ok = (l, cond, d = "") => {
  cond ? pass++ : fail++;
  console.log(`${cond ? "✅" : "❌"} ${l}${d ? " — " + d : ""}`);
};
const CH_USER = "22222222-2222-4222-8222-222222222222";

await c.query("BEGIN");
try {
  // Chauffeur de test.
  await c.query(
    "INSERT INTO chauffeurs (user_id, full_name, phone, gamme, is_verified) VALUES ($1,'Plan Test','+213700000123','classic',true)",
    [CH_USER]
  );
  const chId = (
    await c.query("SELECT id FROM chauffeurs WHERE user_id=$1", [CH_USER])
  ).rows[0].id;

  // Plan personnalisé créé « côté admin » (service_role) : 777 DA/semaine, 5% commission, 2% cashback.
  await c.query(`INSERT INTO drive_plans
    (code,title,price_da,billing_period,duration_days,commission_rate,cashback_rate,is_active,display_rank)
    VALUES ('test_gold','Gold',777,'week',7,0.05,0.02,true,15)`);

  // (1) SÉCURITÉ : impersonation authenticated → aucune écriture possible.
  const asAuthWrite = async (sql) => {
    await c.query("SAVEPOINT s");
    let err = null;
    try {
      await c.query(
        "SELECT set_config('request.jwt.claims',json_build_object('sub',$1::text,'role','authenticated')::text,true)",
        [CH_USER]
      );
      await c.query("SET LOCAL ROLE authenticated");
      await c.query(sql);
    } catch (e) {
      err = e.message;
    }
    // Toujours revenir au savepoint EN PREMIER (annule l'état aborted + SET LOCAL ROLE).
    await c.query("ROLLBACK TO SAVEPOINT s");
    return err;
  };
  ok(
    "chauffeur NE PEUT PAS baisser le prix d'un plan",
    !!(await asAuthWrite(
      "UPDATE drive_plans SET price_da=1 WHERE code='test_gold'"
    ))
  );
  ok(
    "chauffeur NE PEUT PAS s'offrir 0% de commission",
    !!(await asAuthWrite(
      "UPDATE drive_plans SET commission_rate=0 WHERE code='premium'"
    ))
  );
  ok(
    "chauffeur NE PEUT PAS créer un plan gratuit prioritaire",
    !!(await asAuthWrite(
      "INSERT INTO drive_plans(code,title,is_priority) VALUES('hack','x',true)"
    ))
  );

  // (2) drive_subscribe IMPOSE le prix du serveur (aucun paramètre prix côté client).
  await c.query(
    "SELECT set_config('request.jwt.claims',json_build_object('sub',$1::text,'role','authenticated')::text,true)",
    [CH_USER]
  );
  const sub = (
    await c.query("SELECT * FROM drive_subscribe('test_gold','ccp')")
  ).rows[0];
  ok("souscription acceptée", sub.ok, String(sub.reason));
  ok(
    "montant IMPOSÉ = prix du plan (777), pas une valeur cliente",
    sub.amount_da,
    777
  );
  await c.query("RESET ROLE");

  // (3) Après validation admin → plan actif → commission/cashback = ceux du plan.
  await c.query("SELECT drive_sub_mark_paid($1,'admin@test')", [
    sub.payment_id,
  ]);
  const rp = (await c.query("SELECT * FROM resolve_drive_plan($1)", [chId]))
    .rows[0];
  ok("resolve_drive_plan : plan = test_gold", rp.plan, "test_gold");
  ok("commission résolue = 5% du plan", Number(rp.rate), 0.05);
  const cb = (await c.query("SELECT drive_plan_cashback_rate($1) r", [chId]))
    .rows[0].r;
  ok("cashback résolu = 2% du plan", Number(cb), 0.02);
  const rk = (await c.query("SELECT drive_plan_rank($1) r", [chId])).rows[0].r;
  ok("rang d'affichage = 15 du plan", Number(rk), 15);

  // Invariant DB dur : cashback > commission refusé même en service_role.
  let checkErr = null;
  try {
    await c.query("SAVEPOINT s2");
    await c.query(
      "UPDATE drive_plans SET cashback_rate=0.9 WHERE code='test_gold'"
    );
    await c.query("RELEASE SAVEPOINT s2");
  } catch (e) {
    checkErr = e.message;
    await c.query("ROLLBACK TO SAVEPOINT s2");
  }
  ok("invariant DB : cashback > commission REFUSÉ", !!checkErr);

  console.log(
    `\n${fail === 0 ? "🎉 PLANS DRIVE — SÉCURITÉ OK" : "⚠️ ÉCHECS"} : pass=${pass} fail=${fail}`
  );
} catch (e) {
  console.error("ERREUR:", e.message);
  fail++;
} finally {
  await c.query("ROLLBACK");
  await c.end();
}
process.exit(fail === 0 ? 0 : 1);
