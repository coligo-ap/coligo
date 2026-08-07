// =============================================================================
// Test e2e INTER-WILAYAS (mig 0442) — transaction ROLLBACK, zéro trace.
//   node scripts/test-interwilaya.mjs
// Couvre : classification serveur (trigger), kill-switch drive_interwilaya
// (insert refusé, ville épargnée), RPC chauffeur_interwilaya_rides (rayon
// élargi + gate flag), chauffeur_nearby_rides (inter masqué si flag coupé),
// admin_search_rides p_trip (via claims JWT simulées).
// =============================================================================
import { getDbUrl } from "./_supabase.mjs";
import pg from "pg";

const c = new pg.Client({ connectionString: getDbUrl() });
let pass = 0;
let fail = 0;
const ok = (name, cond) => {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}`);
  }
};

await c.connect();
await c.query("BEGIN");
try {
  // Contrainte uq_rides_one_active_per_customer (0252) : chaque insert actif
  // utilise un client DISTINCT, sans course active en cours.
  const custs = (
    await c.query(`
      select cu.id from customers cu
      where not exists (
        select 1 from rides r where r.customer_id = cu.id
          and r.status in ('searching','scheduled','accepted','arriving','arrived','in_progress'))
      limit 4`)
  ).rows.map((r) => r.id);
  if (custs.length < 4) throw new Error("pas assez de clients libres");
  const cust = custs[0];
  // Chauffeur vérifié CLASSIC (les démos Alger le sont) — proche d'Alger.
  const ch = (
    await c.query(`
      select id from chauffeurs
      where is_verified and not is_frozen and not is_blocked and gamme='classic'
      limit 1`)
  ).rows[0];

  // ── 1. Classification serveur (trigger BEFORE INSERT) ──────────────────
  const ins = async () =>
    (
      await c.query(
        `insert into rides (customer_id, status, pickup_lat, pickup_lng, pickup_text,
                            dest_lat, dest_lng, dest_text, distance_km,
                            proposed_price_da, payment_method, gamme)
         values ($1,'searching',36.75,3.06,'Alger',36.75,5.06,'Béjaïa',180,4000,'cash','classic')
         returning id, pickup_wilaya, dest_wilaya, is_interwilaya`,
        [cust]
      )
    ).rows[0];
  const r1 = await ins();
  ok(
    "trigger classe l'inter (16 → 06, is_interwilaya=true)",
    r1.pickup_wilaya === "16" && r1.dest_wilaya === "06" && r1.is_interwilaya
  );
  const rv = (
    await c.query(
      `insert into rides (customer_id, status, pickup_lat, pickup_lng, pickup_text,
                          dest_lat, dest_lng, dest_text, distance_km,
                          proposed_price_da, payment_method, gamme)
       values ($1,'searching',36.75,3.06,'Alger centre',36.76,3.10,'Hydra',6,300,'cash','classic')
       returning is_interwilaya`,
      [custs[1]]
    )
  ).rows[0];
  ok("trajet ville classé ville", rv.is_interwilaya === false);

  // ── 2. RPC sous-page : la course inter est visible (rayon élargi) ──────
  if (ch) {
    const list = (
      await c.query(
        "select id from chauffeur_interwilaya_rides(36.75, 3.06, $1)",
        [ch.id]
      )
    ).rows;
    ok(
      "chauffeur_interwilaya_rides renvoie la course inter",
      list.some((x) => x.id === r1.id)
    );
    ok(
      "chauffeur_interwilaya_rides ne renvoie QUE de l'inter",
      list.every((x) => x.id !== undefined) &&
        !(
          await c.query(
            `select 1 from rides r join (select id from chauffeur_interwilaya_rides(36.75,3.06,$1)) l on l.id=r.id
             where not r.is_interwilaya limit 1`,
            [ch.id]
          )
        ).rows.length
    );
  } else {
    console.log("  ⚠️ pas de chauffeur vérifié — RPC sous-page non testée");
  }

  // ── 3. Kill-switch : insert inter refusé, ville épargnée, listes vides ─
  await c.query(
    "update feature_flags set status='maintenance' where key='drive_interwilaya'"
  );
  await c.query("SAVEPOINT sp1");
  let blocked = false;
  try {
    await c.query(
      `insert into rides (customer_id, status, pickup_lat, pickup_lng, pickup_text,
                          dest_lat, dest_lng, dest_text, distance_km,
                          proposed_price_da, payment_method, gamme)
       values ($1,'searching',36.75,3.06,'Alger',36.75,5.06,'Béjaïa',180,4000,'cash','classic')`,
      [custs[2]]
    );
  } catch (e) {
    blocked = String(e.message).includes("feature_disabled:drive_interwilaya");
    await c.query("ROLLBACK TO SAVEPOINT sp1");
  }
  ok("flag coupé → insert inter REFUSÉ (trigger)", blocked);
  const rv2 = (
    await c.query(
      `insert into rides (customer_id, status, pickup_lat, pickup_lng, pickup_text,
                          dest_lat, dest_lng, dest_text, distance_km,
                          proposed_price_da, payment_method, gamme)
       values ($1,'searching',36.75,3.06,'Alger centre',36.74,3.09,'El Biar',5,300,'cash','classic')
       returning is_interwilaya`,
      [custs[3]]
    )
  ).rows[0];
  ok("flag coupé → insert VILLE passe", rv2.is_interwilaya === false);
  if (ch) {
    const list2 = (
      await c.query(
        "select id from chauffeur_interwilaya_rides(36.75, 3.06, $1)",
        [ch.id]
      )
    ).rows;
    ok("flag coupé → RPC sous-page vide", list2.length === 0);
    const nearby = (
      await c.query(
        "select id from chauffeur_nearby_rides(36.75, 3.06, 20, $1)",
        [ch.id]
      )
    ).rows;
    ok(
      "flag coupé → chauffeur_nearby_rides masque l'inter",
      !nearby.some((x) => x.id === r1.id)
    );
  }
  await c.query(
    "update feature_flags set status='active' where key='drive_interwilaya'"
  );

  // ── 4. admin_search_rides p_trip (claims JWT super-admin simulées) ─────
  const adminEmail = (
    await c.query("select email from platform_admins limit 1")
  ).rows[0]?.email;
  if (adminEmail) {
    await c.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ email: adminEmail, role: "authenticated" }),
    ]);
    const inter = (
      await c.query(
        "select id, is_interwilaya from admin_search_rides(p_trip => 'inter', p_limit => 100)"
      )
    ).rows;
    const ville = (
      await c.query(
        "select id, is_interwilaya from admin_search_rides(p_trip => 'ville', p_limit => 100)"
      )
    ).rows;
    ok(
      "admin_search_rides p_trip='inter' → uniquement de l'inter",
      inter.length > 0 && inter.every((x) => x.is_interwilaya)
    );
    ok(
      "admin_search_rides p_trip='ville' → aucun inter",
      ville.length > 0 && ville.every((x) => !x.is_interwilaya)
    );
  } else {
    console.log("  ⚠️ pas de platform_admin — admin_search_rides non testée");
  }
} finally {
  await c.query("ROLLBACK");
  await c.end();
}
console.log(`\n${pass}/${pass + fail} tests OK${fail ? " — ÉCHECS !" : ""}`);
process.exit(fail ? 1 : 0);
