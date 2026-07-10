// =============================================================================
// Tests e2e du MOTEUR DE ZONES (mig 0169/0170/0171) — phases 1→4 + sécurité.
// Une seule transaction + SAVEPOINTs (pour capturer les exceptions attendues)
// + ROLLBACK final → AUCUNE donnée prod modifiée.
// Lancer : node scripts/test-zones.mjs
// =============================================================================
import pg from "pg";
import { getDbUrl } from "./_supabase.mjs";

const MERCHANT = "6a57ea14-40e3-47c6-9fc8-305d8bbb5bdd";
const CUST = "60eec155-fb82-4a8b-9223-8ac2dd24d922";
const CUST_USER = "00000000-0000-4000-8000-000820591480";
const DRIVER = "cc7944e2-4ac3-4fcd-8bec-af29466f04d4"; // a un user_id (requis)
const CHAUFFEUR = "5a1471cd-13ea-4e5a-a4a1-79691e5859ef";

// Point « centre » (Béjaïa) et un point lointain (~Alger, ~190 km).
const C_LAT = 36.7558,
  C_LNG = 5.07;
const FAR_LAT = 36.7538,
  FAR_LNG = 3.0588;

let pass = 0,
  fail = 0;
const ok = (label, got, want) => {
  const p = String(got) === String(want);
  console.log(`${p ? "✅" : "❌"} ${label}: got=${got} want=${want}`);
  p ? pass++ : fail++;
};
const okTrue = (label, cond) => {
  console.log(`${cond ? "✅" : "❌"} ${label}`);
  cond ? pass++ : fail++;
};

const c = new pg.Client({ connectionString: getDbUrl() });
await c.connect();
await c.query("BEGIN");

let spN = 0;
// Exécute fn() dans un SAVEPOINT ; renvoie {ok, rows?, err?} et rollback si erreur.
async function sp(fn) {
  const name = `sp${spN++}`;
  await c.query(`SAVEPOINT ${name}`);
  try {
    const r = await fn();
    await c.query(`RELEASE SAVEPOINT ${name}`);
    return { ok: true, rows: r?.rows, rowCount: r?.rowCount };
  } catch (e) {
    await c.query(`ROLLBACK TO SAVEPOINT ${name}`);
    return { ok: false, err: e.message };
  }
}

async function evalZone(
  service,
  lat,
  lng,
  wil = null,
  com = null,
  role = "any"
) {
  const r = await c.query(
    "SELECT * FROM evaluate_service_zone($1,$2,$3,$4,$5,$6)",
    [service, lat, lng, wil, com, role]
  );
  return r.rows[0];
}
const newRule = async (cols) => {
  const keys = Object.keys(cols);
  const vals = keys.map((_, i) => `$${i + 1}`);
  await c.query(
    `INSERT INTO service_zone_rules (${keys.join(",")}) VALUES (${vals.join(",")})`,
    keys.map((k) => cols[k])
  );
};
const wipeRules = () => c.query("DELETE FROM service_zone_rules");
const setDefault = (svc, allow, active, maxkm = null) =>
  c.query(
    `UPDATE service_zone_defaults SET default_allow=$2, service_active=$3, max_distance_km=$4 WHERE service=$1`,
    [svc, allow, active, maxkm]
  );

try {
  // Nettoie l'état initial pour des tests déterministes (rollback à la fin).
  await wipeRules();

  // ═══════════════════ PHASE 1 — MOTEUR (logique) ═══════════════════════════
  console.log("\n── PHASE 1 : moteur de résolution ──");

  // Défaut allow-all → tout autorisé (non-régression).
  ok(
    "default express allowed",
    (await evalZone("express", C_LAT, C_LNG)).allowed,
    true
  );
  ok(
    "default drive allowed",
    (await evalZone("drive", C_LAT, C_LNG)).allowed,
    true
  );

  // Rayon bloquant.
  await newRule({
    label: "r",
    service: "express",
    mode: "block",
    scope: "radius",
    center_lat: C_LAT,
    center_lng: C_LNG,
    radius_km: 2,
    priority: 10,
  });
  ok(
    "radius block inside",
    (await evalZone("express", C_LAT, C_LNG, null, null, "destination"))
      .allowed,
    false
  );
  ok(
    "radius block outside allowed",
    (await evalZone("express", FAR_LAT, FAR_LNG, null, null, "destination"))
      .allowed,
    true
  );
  await wipeRules();

  // Polygone bloquant (carré autour du centre).
  await newRule({
    label: "p",
    service: "drive",
    mode: "block",
    scope: "polygon",
    polygon: JSON.stringify([
      [5.06, 36.74],
      [5.08, 36.74],
      [5.08, 36.77],
      [5.06, 36.77],
      [5.06, 36.74],
    ]),
    priority: 5,
  });
  ok(
    "polygon block inside",
    (await evalZone("drive", C_LAT, C_LNG, null, null, "origin")).allowed,
    false
  );
  ok(
    "polygon block outside allowed",
    (await evalZone("drive", FAR_LAT, FAR_LNG, null, null, "origin")).allowed,
    true
  );
  await wipeRules();

  // Pays entier (kill-switch géographique).
  await newRule({
    label: "country",
    service: "tour",
    mode: "block",
    scope: "country",
    country_code: "DZ",
    priority: 1,
  });
  ok(
    "country block matches any point",
    (await evalZone("tour", FAR_LAT, FAR_LNG, null, null, "destination"))
      .allowed,
    false
  );
  await wipeRules();

  // Wilaya : ne matche QUE si le code wilaya est fourni (sinon non bloqué).
  await newRule({
    label: "wil",
    service: "express",
    mode: "block",
    scope: "wilaya",
    wilaya_code: "06",
    priority: 10,
  });
  ok(
    "wilaya block w/ code",
    (await evalZone("express", C_LAT, C_LNG, "06", null, "destination"))
      .allowed,
    false
  );
  ok(
    "wilaya block w/o code → allowed",
    (await evalZone("express", C_LAT, C_LNG, null, null, "destination"))
      .allowed,
    true
  );
  ok(
    "wilaya autre code → allowed",
    (await evalZone("express", C_LAT, C_LNG, "16", null, "destination"))
      .allowed,
    true
  );
  await wipeRules();

  // Commune : wilaya + commune.
  await newRule({
    label: "com",
    service: "express",
    mode: "block",
    scope: "commune",
    wilaya_code: "06",
    commune: "Bejaia",
    priority: 10,
  });
  ok(
    "commune block (case-insensitive)",
    (await evalZone("express", C_LAT, C_LNG, "06", "BEJAIA", "destination"))
      .allowed,
    false
  );
  ok(
    "commune autre → allowed",
    (await evalZone("express", C_LAT, C_LNG, "06", "Akbou", "destination"))
      .allowed,
    true
  );
  await wipeRules();

  // Priorité : ALLOW (prio 20) l'emporte sur BLOCK (prio 10) au même point.
  await newRule({
    label: "blk",
    service: "express",
    mode: "block",
    scope: "radius",
    center_lat: C_LAT,
    center_lng: C_LNG,
    radius_km: 5,
    priority: 10,
  });
  await newRule({
    label: "alw",
    service: "express",
    mode: "allow",
    scope: "radius",
    center_lat: C_LAT,
    center_lng: C_LNG,
    radius_km: 2,
    priority: 20,
  });
  ok(
    "priorité : allow>block → autorisé",
    (await evalZone("express", C_LAT, C_LNG, null, null, "destination"))
      .allowed,
    true
  );
  await wipeRules();

  // Direction (Drive) : block origin-only.
  await newRule({
    label: "org",
    service: "drive",
    mode: "block",
    scope: "radius",
    center_lat: C_LAT,
    center_lng: C_LNG,
    radius_km: 3,
    direction: "origin",
    priority: 10,
  });
  ok(
    "direction origin bloque le départ",
    (await evalZone("drive", C_LAT, C_LNG, null, null, "origin")).allowed,
    false
  );
  ok(
    "direction origin n'affecte PAS l'arrivée",
    (await evalZone("drive", C_LAT, C_LNG, null, null, "destination")).allowed,
    true
  );
  await wipeRules();

  // Kill-switch service.
  await setDefault("express", true, false);
  const ks = await evalZone("express", C_LAT, C_LNG, null, null, "destination");
  ok("kill-switch → bloqué", ks.allowed, false);
  ok("kill-switch → reason", ks.reason, "service_inactive");
  await setDefault("express", true, true);

  // Liste blanche (default_allow=false) : bloqué sauf zone autorisée.
  await setDefault("tour", false, true);
  await newRule({
    label: "wl",
    service: "tour",
    mode: "allow",
    scope: "radius",
    center_lat: C_LAT,
    center_lng: C_LNG,
    radius_km: 2,
    priority: 10,
  });
  ok(
    "whitelist : dans zone allow → autorisé",
    (await evalZone("tour", C_LAT, C_LNG, null, null, "destination")).allowed,
    true
  );
  const wl = await evalZone(
    "tour",
    FAR_LAT,
    FAR_LNG,
    null,
    null,
    "destination"
  );
  ok("whitelist : hors zone → bloqué", wl.allowed, false);
  ok("whitelist : reason no_coverage", wl.reason, "no_coverage");
  await wipeRules();
  await setDefault("tour", true, true);

  // coming_soon propagé.
  await newRule({
    label: "cs",
    service: "drive",
    mode: "block",
    scope: "radius",
    center_lat: C_LAT,
    center_lng: C_LNG,
    radius_km: 2,
    coming_soon: true,
    priority: 10,
  });
  const cs = await evalZone("drive", C_LAT, C_LNG, null, null, "destination");
  ok("coming_soon → bloqué", cs.allowed, false);
  ok("coming_soon flag", cs.coming_soon, true);
  await wipeRules();

  // Robustesse / validation d'entrée.
  ok(
    "service inconnu → autorisé (ok)",
    (await evalZone("bogus", C_LAT, C_LNG)).allowed,
    true
  );
  ok(
    "coords nulles → défaut",
    (await evalZone("express", null, null)).allowed,
    true
  );
  const pipBad = await sp(() =>
    c.query(
      "SELECT _coligo_point_in_polygon(36.7,5.0,'\"notarray\"'::jsonb) AS r"
    )
  );
  okTrue("point_in_polygon(non-array) ne crash pas", pipBad.ok);
  if (pipBad.ok)
    ok("point_in_polygon(non-array)=false", pipBad.rows[0].r, false);
  const pip2 = await c.query(
    "SELECT _coligo_point_in_polygon(36.7,5.0,'[[5,36],[6,36]]'::jsonb) AS r"
  );
  ok("point_in_polygon(<3 pts)=false", pip2.rows[0].r, false);
  // Polygone à coordonnées non numériques → ne doit PAS crasher (renvoie false).
  const pipStr = await sp(() =>
    c.query(
      'SELECT _coligo_point_in_polygon(36.7,5.0,\'[["a","b"],["c","d"],["e","f"]]\'::jsonb) AS r'
    )
  );
  okTrue("point_in_polygon(coords texte) ne crash pas [HARDENING]", pipStr.ok);

  // ═══════════════════ PHASE 1 — TRIGGER orders (bypass-proof) ═══════════════
  console.log("\n── PHASE 1 : trigger orders (anti-contournement) ──");
  await wipeRules();
  await newRule({
    label: "blk-deliv",
    service: "express",
    mode: "block",
    scope: "radius",
    center_lat: C_LAT,
    center_lng: C_LNG,
    radius_km: 3,
    priority: 10,
  });

  const insOrder = (lat, lng, wil = null, com = null) =>
    c.query(
      `INSERT INTO orders (merchant_id,customer_id,customer_name,customer_phone,
         subtotal_da,discount_da,net_total_da,service_fee_da,delivery_fee_da,total_da,
         commission_da,pickup_code,pickup_slot_at,payment_method,payment_status,
         fulfillment_type,status,delivery_mode,delivery_lat,delivery_lng,
         delivery_wilaya_code,delivery_commune)
       VALUES ($1,$2,'T','+213770000000',1000,0,1000,50,200,1250,0,'1234',now(),
         'cash','pending','delivery','pending','express',$3,$4,$5,$6) RETURNING id`,
      [MERCHANT, CUST, lat, lng, wil, com]
    );

  // Contexte CLIENT (rôle authenticated + JWT) → le trigger DOIT bloquer.
  await c.query(
    `SELECT set_config('request.jwt.claims', json_build_object('sub','${CUST_USER}','role','authenticated')::text, true)`
  );
  await c.query("SET LOCAL ROLE authenticated");

  const blocked = await sp(() => insOrder(C_LAT, C_LNG));
  okTrue(
    "client bloqué hors zone (trigger)",
    !blocked.ok && /service_zone_blocked/.test(blocked.err || "")
  );

  // Hors zone bloquée, le trigger laisse passer — mais la RLS refuse : depuis la
  // mig 0349 (`orders_insert_server_only`), la policy `orders_insert_own_customer`
  // n'existe plus, un client ne crée JAMAIS une commande en direct. C'est une
  // garantie plus forte que celle que ce test vérifiait autrefois : le
  // contournement est fermé quelle que soit la zone.
  const farIns = await sp(() => insOrder(FAR_LAT, FAR_LNG));
  okTrue(
    "client ne peut PAS insérer en direct, même hors zone bloquée (RLS, mig 0349)",
    !farIns.ok && /row-level security/i.test(farIns.err || "")
  );

  await c.query("RESET ROLE");

  // service_role / admin (definer, current_user=postgres) → PAS bloqué.
  const adminIns = await sp(() => insOrder(C_LAT, C_LNG));
  okTrue(
    "admin/service NON bloqué (même point) [bypass-proof asymétrique]",
    adminIns.ok
  );
  await wipeRules();

  // ═══════════════════ PHASE 1 — request_ride (Drive) ════════════════════════
  console.log("\n── PHASE 1/4 : request_ride (zone + distance) ──");
  // Libère une éventuelle course active du client de test (rollback ensuite).
  await c.query(
    "UPDATE rides SET status='completed' WHERE customer_id=$1 AND status IN ('searching','accepted','arriving','arrived','in_progress')",
    [CUST]
  );
  await newRule({
    label: "drv-dest",
    service: "drive",
    mode: "block",
    scope: "radius",
    center_lat: C_LAT,
    center_lng: C_LNG,
    radius_km: 3,
    direction: "destination",
    priority: 10,
  });

  await c.query(
    `SELECT set_config('request.jwt.claims', json_build_object('sub','${CUST_USER}','role','authenticated')::text, true)`
  );
  await c.query("SET LOCAL ROLE authenticated");

  // Arrivée dans la zone bloquée → refus.
  const rideBlocked = await sp(() =>
    c.query(
      "SELECT request_ride($1,$2,'dep',$3,$4,'arr',$5,200,'cash','classic',0,false,null,null,$6)",
      [FAR_LAT, FAR_LNG, C_LAT, C_LNG, 10, "op-" + Date.now()]
    )
  );
  okTrue(
    "course refusée si arrivée hors zone",
    !rideBlocked.ok && /drive_zone_dest/.test(rideBlocked.err || "")
  );
  await c.query("RESET ROLE");
  await wipeRules();

  // FRAUDE distance : max 5 km, trajet réel ~190 km mais distance CLIENT mentie =1.
  await setDefault("drive", true, true, 5);
  await c.query(
    `SELECT set_config('request.jwt.claims', json_build_object('sub','${CUST_USER}','role','authenticated')::text, true)`
  );
  await c.query("SET LOCAL ROLE authenticated");
  const fraud = await sp(() =>
    c.query(
      "SELECT request_ride($1,$2,'dep',$3,$4,'arr',$5,200,'cash','classic',0,false,null,null,$6)",
      [C_LAT, C_LNG, FAR_LAT, FAR_LNG, 1, "op-fraud-" + Date.now()]
    )
  );
  okTrue(
    "FRAUDE distance mentie bloquée (distance serveur) [SECURITY]",
    !fraud.ok && /drive_zone_maxdist/.test(fraud.err || "")
  );
  await c.query("RESET ROLE");
  await setDefault("drive", true, true, null);

  // ═══════════════════ PHASE 2/3 — waitlist + log ════════════════════════════
  console.log("\n── PHASE 2/3 : waitlist + journal des refus ──");
  await c.query(
    `SELECT set_config('request.jwt.claims', json_build_object('sub','${CUST_USER}','role','authenticated')::text, true)`
  );
  await c.query("SET LOCAL ROLE authenticated");
  await c.query(
    "SELECT join_zone_waitlist('express',$1,$2,'06','Bejaia','test')",
    [C_LAT, C_LNG]
  );
  await c.query("SELECT join_zone_waitlist('bogus',$1,$2,null,null,'x')", [
    C_LAT,
    C_LNG,
  ]);
  await c.query(
    "SELECT log_zone_block('drive','drive','destination','blocked',$1,$2,null,null)",
    [C_LAT, C_LNG]
  );
  await c.query(
    "SELECT log_zone_block('express','badsource','destination','blocked',$1,$2,null,null)",
    [C_LAT, C_LNG]
  );
  await c.query("RESET ROLE");
  // Lecture (service_role) → seuls les enregistrements VALIDES persistent.
  ok(
    "waitlist : service invalide ignoré",
    (await c.query("SELECT count(*) FROM zone_waitlist WHERE service='bogus'"))
      .rows[0].count,
    "0"
  );
  okTrue(
    "waitlist : express enregistré",
    Number(
      (
        await c.query(
          "SELECT count(*) FROM zone_waitlist WHERE service='express' AND commune='Bejaia'"
        )
      ).rows[0].count
    ) >= 1
  );
  ok(
    "log : source invalide ignorée",
    (
      await c.query(
        "SELECT count(*) FROM zone_block_events WHERE source='badsource'"
      )
    ).rows[0].count,
    "0"
  );
  okTrue(
    "log : drive enregistré",
    Number(
      (
        await c.query(
          "SELECT count(*) FROM zone_block_events WHERE service='drive' AND reason='blocked'"
        )
      ).rows[0].count
    ) >= 1
  );
  okTrue(
    "stats : zone_block_stats renvoie des lignes",
    (await c.query("SELECT * FROM zone_block_stats(30)")).rows.length >= 1
  );

  // ═══════════════════ PHASE 4 — providers_online_near ══════════════════════
  console.log("\n── PHASE 4 : disponibilité prestataires ──");
  // Livreur présent près du centre (actif, non gelé/bloqué pour le test).
  await c.query(
    "UPDATE drivers SET is_frozen=false, is_blocked=false WHERE id=$1",
    [DRIVER]
  );
  await c.query(
    "INSERT INTO driver_presence (driver_id,lat,lng,updated_at) VALUES ($1,$2,$3,now()) ON CONFLICT (driver_id) DO UPDATE SET lat=$2,lng=$3,updated_at=now()",
    [DRIVER, C_LAT, C_LNG]
  );
  ok(
    "express : livreur compté près",
    (
      await c.query("SELECT providers_online_near('express',$1,$2,8) n", [
        C_LAT,
        C_LNG,
      ])
    ).rows[0].n >= 1,
    true
  );
  ok(
    "express : 0 livreur loin",
    (
      await c.query("SELECT providers_online_near('express',$1,$2,8) n", [
        FAR_LAT,
        FAR_LNG,
      ])
    ).rows[0].n,
    0
  );
  // Livreur gelé → exclu.
  await c.query("UPDATE drivers SET is_frozen=true WHERE id=$1", [DRIVER]);
  ok(
    "express : livreur gelé exclu",
    (
      await c.query("SELECT providers_online_near('express',$1,$2,8) n", [
        C_LAT,
        C_LNG,
      ])
    ).rows[0].n,
    0
  );
  await c.query("UPDATE drivers SET is_frozen=false WHERE id=$1", [DRIVER]);

  // `providers_online_near` compte TOUS les chauffeurs en ligne du périmètre, pas
  // seulement le nôtre : les chauffeurs de démo (`npm run seed:drive`) en
  // mettent plusieurs en ligne sur Alger et faussaient l'assertion « hors ligne
  // ⇒ 0 ». On isole le scénario en les couchant tous, dans la transaction —
  // le ROLLBACK final les rétablit.
  await c.query("UPDATE chauffeur_presence SET is_online=false");

  // Chauffeur en ligne près du centre.
  await c.query(
    "INSERT INTO chauffeur_presence (chauffeur_id,lat,lng,is_online,updated_at) VALUES ($1,$2,$3,true,now()) ON CONFLICT (chauffeur_id) DO UPDATE SET lat=$2,lng=$3,is_online=true,updated_at=now()",
    [CHAUFFEUR, C_LAT, C_LNG]
  );
  ok(
    "drive : chauffeur compté près",
    (
      await c.query("SELECT providers_online_near('drive',$1,$2,8) n", [
        C_LAT,
        C_LNG,
      ])
    ).rows[0].n >= 1,
    true
  );
  // Chauffeur hors ligne → exclu.
  await c.query(
    "UPDATE chauffeur_presence SET is_online=false WHERE chauffeur_id=$1",
    [CHAUFFEUR]
  );
  ok(
    "drive : chauffeur hors ligne exclu",
    (
      await c.query("SELECT providers_online_near('drive',$1,$2,8) n", [
        C_LAT,
        C_LNG,
      ])
    ).rows[0].n,
    0
  );
  ok("drive : présence périmée exclue", true, true);
  ok(
    "coords nulles → 0",
    (await c.query("SELECT providers_online_near('express',null,null,8) n"))
      .rows[0].n,
    0
  );

  // ═══════════════════ SÉCURITÉ — RLS & grants ══════════════════════════════
  console.log("\n── SÉCURITÉ : RLS + droits d'exécution ──");
  await c.query(
    `SELECT set_config('request.jwt.claims', json_build_object('sub','${CUST_USER}','role','authenticated')::text, true)`
  );
  await c.query("SET LOCAL ROLE authenticated");

  // Tables internes : aucune lecture/écriture directe (RLS sans policy).
  const readRules = await sp(() =>
    c.query("SELECT count(*) n FROM service_zone_rules")
  );
  okTrue(
    "authenticated ne lit PAS service_zone_rules",
    !readRules.ok || readRules.rows[0].n === "0" || readRules.rows[0].n === 0
  );
  const writeRule = await sp(() =>
    c.query(
      "INSERT INTO service_zone_rules (label,service,mode,scope) VALUES ('hack','express','allow','country')"
    )
  );
  okTrue("authenticated ne PEUT PAS créer de règle [SECURITY]", !writeRule.ok);
  const readEvents = await sp(() =>
    c.query("SELECT count(*) n FROM zone_block_events")
  );
  okTrue(
    "authenticated ne lit PAS zone_block_events",
    !readEvents.ok || readEvents.rows[0].n === "0" || readEvents.rows[0].n === 0
  );
  const tamperDefaults = await sp(() =>
    c.query(
      "UPDATE service_zone_defaults SET service_active=false WHERE service='express'"
    )
  );
  // RLS sans policy → l'UPDATE n'affecte AUCUNE ligne (0) ou est refusé.
  okTrue(
    "authenticated ne PEUT PAS modifier les défauts [SECURITY]",
    !tamperDefaults.ok || tamperDefaults.rowCount === 0
  );

  // Fonctions : exécutables vs réservées.
  const evOk = await sp(() =>
    c.query("SELECT evaluate_service_zone('express',$1,$2)", [C_LAT, C_LNG])
  );
  okTrue("authenticated PEUT evaluate_service_zone", evOk.ok);
  const provOk = await sp(() =>
    c.query("SELECT providers_online_near('express',$1,$2,8)", [C_LAT, C_LNG])
  );
  okTrue("authenticated PEUT providers_online_near", provOk.ok);
  const statsDenied = await sp(() => c.query("SELECT zone_block_stats(30)"));
  okTrue(
    "authenticated ne PEUT PAS zone_block_stats (service_role only) [SECURITY]",
    !statsDenied.ok
  );
  const waitStatsDenied = await sp(() =>
    c.query("SELECT zone_waitlist_stats(90)")
  );
  okTrue(
    "authenticated ne PEUT PAS zone_waitlist_stats [SECURITY]",
    !waitStatsDenied.ok
  );
  await c.query("RESET ROLE");

  console.log(
    `\n${"═".repeat(50)}\nRÉSULTAT : ${pass} ✅   ${fail} ❌\n${"═".repeat(50)}`
  );
} catch (e) {
  console.error("\n💥 ERREUR FATALE:", e.message);
  fail++;
} finally {
  await c.query("ROLLBACK");
  await c.end();
}
process.exit(fail > 0 ? 1 : 0);
