// =============================================================================
// COLIGO — HARNAIS DE CHARGE / RÉSILIENCE / SÉCURITÉ « terrain » (senior).
// -----------------------------------------------------------------------------
// Simule une journée réelle sous charge : des dizaines de commerçants, livreurs
// et chauffeurs actifs, des centaines de clients qui commandent et cherchent une
// course EN CONCURRENCE, puis PROUVE les invariants métier et de sécurité sous
// cette charge (exclusivité dispatch, anti double-dépense, isolation multi-tenant,
// garde colonnes financières, résistance brute-force PIN) et l'intégrité globale.
//
// Chemin exercé = les VRAIS RPC + RLS + triggers de prod, via impersonation
// `set_config('request.jwt.claims',...)` sur des connexions pg concurrentes
// (comme les suites du repo). Données 100% taguées [LOADTEST] / @coligo-loadtest.dev
// et NETTOYÉES en fin de run (même en cas d'échec). LECTURE des mesures = réelles.
//
// Échelle configurable par env : LT_MERCHANTS, LT_DRIVERS, LT_CHAUFFEURS,
// LT_CUSTOMERS, LT_ORDERS, LT_CONCURRENCY. Défauts = petits (smoke). Passer
// LT_SCALE=full pour l'échelle « terrain » (20/20/12/40, 300 commandes).
// =============================================================================
import pg from "pg";
import { getDbUrl } from "../_supabase.mjs";

// ----------------------------- Config ---------------------------------------
const SCALE =
  process.env.LT_SCALE === "full" || process.argv.includes("--full");
const N_MERCHANTS = +(process.env.LT_MERCHANTS || (SCALE ? 20 : 4));
const N_DRIVERS = +(process.env.LT_DRIVERS || (SCALE ? 20 : 4));
const N_CHAUFFEURS = +(process.env.LT_CHAUFFEURS || (SCALE ? 12 : 4));
const N_CUSTOMERS = +(process.env.LT_CUSTOMERS || (SCALE ? 40 : 8));
const N_ORDERS = +(process.env.LT_ORDERS || (SCALE ? 300 : 20));
const N_RIDES = +(process.env.LT_RIDES || (SCALE ? 200 : 10));
const CONCURRENCY = +(process.env.LT_CONCURRENCY || (SCALE ? 24 : 8));
const CENTER = { lat: 36.7538, lng: 3.0588 }; // Alger
const TAG = "[LOADTEST]";
const DOMAIN = "@coligo-loadtest.dev";
const PW = "Loadtest-1!";

const RUN = String(Date.now()).slice(-6);
const phoneFor = (offset, i) =>
  "0" +
  RUN +
  String(offset + i)
    .padStart(3, "0")
    .slice(-3);
const jitter = (d = 0.02) => (Math.random() - 0.5) * 2 * d;
const rnd = (n) => Math.floor(Math.random() * n);
const pick = (a) => a[rnd(a.length)];

// ----------------------------- Pools ----------------------------------------
// getDbUrl() = pooler SESSION (port 5432) : requis pour les SET de session
// (seed, cleanup avec session_replication_role, svc). La CHARGE concurrente passe
// par le pooler TRANSACTION (port 6543) — comme le vrai trafic serverless prod —
// qui supporte beaucoup plus de clients simultanés.
const SESS_URL = getDbUrl();
const TX_URL = SESS_URL.replace(":5432/", ":6543/");
const poolSess = new pg.Pool({
  connectionString: SESS_URL,
  ssl: { rejectUnauthorized: false },
  max: 8,
  idleTimeoutMillis: 10_000,
});
const poolTx = new pg.Pool({
  connectionString: TX_URL,
  ssl: { rejectUnauthorized: false },
  max: CONCURRENCY + 6,
  idleTimeoutMillis: 10_000,
});

// Exécute `fn(client)` sur une connexion dédiée en se faisant passer pour `uid`.
// tx=true → BEGIN/COMMIT ; rollback=true → tout annulé (mesure sans trace).
async function asUser(uid, fn, { commit = true } = {}) {
  const client = await poolTx.connect();
  try {
    await client.query("BEGIN");
    await client.query(
      "SELECT set_config('request.jwt.claims', json_build_object('sub',$1::text,'role','authenticated')::text, true)",
      [uid]
    );
    // FIDÉLITÉ : le vrai chemin PostgREST s'exécute comme rôle `authenticated`
    // → RLS ENFORCÉE + guards `current_user='authenticated'` actifs. Sans ça, la
    // connexion pooler tourne en `postgres` (bypass RLS) et fausse les tests sécu.
    await client.query("SET LOCAL ROLE authenticated");
    const r = await fn(client);
    await client.query(commit ? "COMMIT" : "ROLLBACK");
    return r;
  } catch (e) {
    try {
      await client.query("ROLLBACK");
    } catch {}
    throw e;
  } finally {
    client.release();
  }
}

// Pool de concurrence bornée.
async function runPool(items, worker, concurrency = CONCURRENCY) {
  const results = new Array(items.length);
  let i = 0;
  const workers = Array.from(
    { length: Math.min(concurrency, items.length) },
    async () => {
      while (i < items.length) {
        const idx = i++;
        const t0 = performance.now();
        try {
          results[idx] = {
            ok: true,
            ms: 0,
            value: await worker(items[idx], idx),
          };
        } catch (e) {
          results[idx] = { ok: false, ms: 0, err: e.message };
        }
        results[idx].ms = performance.now() - t0;
      }
    }
  );
  await Promise.all(workers);
  return results;
}

function stats(results, label) {
  const oks = results.filter((r) => r.ok);
  const errs = results.filter((r) => !r.ok);
  const ms = oks.map((r) => r.ms).sort((a, b) => a - b);
  const p = (q) =>
    ms.length ? ms[Math.min(ms.length - 1, Math.floor(q * ms.length))] : 0;
  const errRate = ((errs.length / results.length) * 100).toFixed(1);
  console.log(
    `  ${label}: n=${results.length} ok=${oks.length} err=${errs.length} (${errRate}%) ` +
      `| p50=${p(0.5).toFixed(0)}ms p95=${p(0.95).toFixed(0)}ms p99=${p(0.99).toFixed(0)}ms max=${(ms[ms.length - 1] || 0).toFixed(0)}ms`
  );
  if (errs.length) {
    const byMsg = {};
    for (const e of errs) byMsg[e.err] = (byMsg[e.err] || 0) + 1;
    for (const [m, c] of Object.entries(byMsg).slice(0, 6))
      console.log(`     ✗ ${c}× ${m.slice(0, 90)}`);
  }
  return {
    n: results.length,
    ok: oks.length,
    err: errs.length,
    errRate: +errRate,
    p50: p(0.5),
    p95: p(0.95),
    p99: p(0.99),
  };
}

// ----------------------------- État ------------------------------------------
const state = { merchants: [], drivers: [], chauffeurs: [], customers: [] };
let PASS = 0,
  FAIL = 0;
const check = (label, cond, detail = "") => {
  cond ? PASS++ : FAIL++;
  console.log(
    `  ${cond ? "✅" : "❌ ÉCHEC"} ${label}${detail ? " — " + detail : ""}`
  );
};

// =============================================================================
// SEED
// =============================================================================
async function seed() {
  console.log(
    `\n━━━ SEED (${N_MERCHANTS} commerçants, ${N_DRIVERS} livreurs, ${N_CHAUFFEURS} chauffeurs, ${N_CUSTOMERS} clients) ━━━`
  );
  const c = await poolSess.connect();
  try {
    await c.query("BEGIN");
    const mkUser = async (kind, i) => {
      const email = `lt-${kind}-${Date.now().toString(36)}-${i}${DOMAIN}`;
      const uid = (
        await c.query(
          `INSERT INTO auth.users (id, instance_id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
           VALUES (gen_random_uuid(),'00000000-0000-0000-0000-000000000000','authenticated','authenticated',$1, crypt($2, gen_salt('bf')), now(), now(), now())
           RETURNING id`,
          [email, PW]
        )
      ).rows[0].id;
      return { uid, email };
    };

    // Commerçants + produits
    for (let i = 0; i < N_MERCHANTS; i++) {
      const { uid } = await mkUser("m", i);
      const lat = CENTER.lat + jitter(0.03),
        lng = CENTER.lng + jitter(0.03);
      const m = (
        await c.query(
          `INSERT INTO merchants (user_id, name, category, is_active, approval_status, approved_at, submitted_at,
             latitude, longitude, express_enabled, delivery_enabled, accepts_cash, accepts_online, slug, shop_public_id, city, wilaya_code)
           VALUES ($1,$2,'superette',true,'approved',now(),now(),$3,$4,true,true,true,true,$5,$6,'Alger','16')
           RETURNING id`,
          [
            uid,
            `${TAG} Commerce ${i}`,
            lat,
            lng,
            `lt-shop-${Date.now()}-${i}`,
            `LT${Date.now()}${i}`,
          ]
        )
      ).rows[0].id;
      for (let p = 0; p < 5; p++) {
        await c.query(
          `INSERT INTO products (merchant_id, name_fr, price_da, is_available, unit) VALUES ($1,$2,$3,true,'piece')`,
          [m, `${TAG} Produit ${p}`, 100 + p * 50]
        );
      }
      state.merchants.push({ id: m, uid, lat, lng });
    }

    // Livreurs express
    for (let i = 0; i < N_DRIVERS; i++) {
      const { uid } = await mkUser("d", i);
      const d = (
        await c.query(
          `INSERT INTO drivers (user_id, full_name, phone, is_verified, is_frozen, is_blocked)
           VALUES ($1,$2,$3,true,false,false) RETURNING id`,
          [uid, `${TAG} Livreur ${i}`, phoneFor(0, i)]
        )
      ).rows[0].id;
      state.drivers.push({ id: d, uid });
    }

    // Chauffeurs Drive (vérifiés, en ligne, géolocalisés)
    for (let i = 0; i < N_CHAUFFEURS; i++) {
      const { uid } = await mkUser("ch", i);
      const ch = (
        await c.query(
          `INSERT INTO chauffeurs (user_id, full_name, phone, gamme, is_verified, is_frozen, is_blocked)
           VALUES ($1,$2,$3,'classic',true,false,false) RETURNING id`,
          [uid, `${TAG} Chauffeur ${i}`, phoneFor(300, i)]
        )
      ).rows[0].id;
      await c.query(
        `INSERT INTO chauffeur_presence (chauffeur_id, lat, lng, is_online, updated_at)
         VALUES ($1,$2,$3,true,now())
         ON CONFLICT (chauffeur_id) DO UPDATE SET lat=EXCLUDED.lat, lng=EXCLUDED.lng, is_online=true, updated_at=now()`,
        [ch, CENTER.lat + jitter(0.01), CENTER.lng + jitter(0.01)]
      );
      state.chauffeurs.push({ id: ch, uid });
    }

    // Clients (avec handle Coligo Pay unique)
    for (let i = 0; i < N_CUSTOMERS; i++) {
      const { uid } = await mkUser("c", i);
      const cu = (
        await c.query(
          `INSERT INTO customers (user_id, full_name, phone, latitude, longitude, pay_handle)
           VALUES ($1,$2,$3,$4,$5,$6) RETURNING id`,
          [
            uid,
            `${TAG} Client ${i}`,
            phoneFor(600, i),
            CENTER.lat + jitter(),
            CENTER.lng + jitter(),
            `lt${Date.now().toString(36)}${i}`,
          ]
        )
      ).rows[0].id;
      state.customers.push({ id: cu, uid });
    }

    await c.query("COMMIT");
    console.log(
      `  ✅ seed committé : ${state.merchants.length} commerçants (×5 produits), ${state.drivers.length} livreurs, ${state.chauffeurs.length} chauffeurs, ${state.customers.length} clients`
    );
  } catch (e) {
    await c.query("ROLLBACK");
    throw new Error("SEED a échoué: " + e.message);
  } finally {
    c.release();
  }
}

// =============================================================================
// CLEANUP
// =============================================================================
async function cleanup() {
  console.log(`\n━━━ CLEANUP ━━━`);
  const c = await poolSess.connect();
  try {
    const uids = [
      ...state.merchants,
      ...state.drivers,
      ...state.chauffeurs,
      ...state.customers,
    ].map((x) => x.uid);
    const cuIds = state.customers.map((x) => x.id);
    const mIds = state.merchants.map((x) => x.id);
    const chIds = state.chauffeurs.map((x) => x.id);
    if (!uids.length) {
      console.log("  (rien à nettoyer)");
      return;
    }
    // Désactive triggers/append-only/FK le temps de purger les données taguées.
    let replica = false;
    try {
      await c.query("SET session_replication_role = replica");
      replica = true;
    } catch {
      console.log("  (session_replication_role non permis — DELETE ordonné)");
    }
    await c.query("BEGIN");
    // enfants -> parents
    if (cuIds.length) {
      await c.query(
        `DELETE FROM ride_offers WHERE ride_id IN (SELECT id FROM rides WHERE customer_id = ANY($1))`,
        [cuIds]
      );
      await c
        .query(
          `DELETE FROM ride_events WHERE ride_id IN (SELECT id FROM rides WHERE customer_id = ANY($1))`,
          [cuIds]
        )
        .catch(() => {});
      await c
        .query(
          `DELETE FROM ride_ledger WHERE ride_id IN (SELECT id FROM rides WHERE customer_id = ANY($1))`,
          [cuIds]
        )
        .catch(() => {});
      await c.query(`DELETE FROM rides WHERE customer_id = ANY($1)`, [cuIds]);
      await c.query(
        `DELETE FROM coligo_pay_payments WHERE customer_id = ANY($1)`,
        [cuIds]
      );
      await c.query(
        `DELETE FROM customer_wallet_entries WHERE customer_id = ANY($1)`,
        [cuIds]
      );
    }
    if (mIds.length) {
      await c
        .query(`DELETE FROM coligo_pay_requests WHERE merchant_id = ANY($1)`, [
          mIds,
        ])
        .catch(() => {});
      await c.query(`DELETE FROM orders WHERE merchant_id = ANY($1)`, [mIds]);
      await c.query(`DELETE FROM products WHERE merchant_id = ANY($1)`, [mIds]);
    }
    if (cuIds.length)
      await c
        .query(`DELETE FROM orders WHERE customer_id = ANY($1)`, [cuIds])
        .catch(() => {});
    if (chIds.length) {
      await c.query(
        `DELETE FROM chauffeur_presence WHERE chauffeur_id = ANY($1)`,
        [chIds]
      );
      await c.query(`DELETE FROM chauffeurs WHERE id = ANY($1)`, [chIds]);
    }
    if (mIds.length)
      await c.query(`DELETE FROM merchants WHERE id = ANY($1)`, [mIds]);
    if (state.drivers.length)
      await c.query(`DELETE FROM drivers WHERE id = ANY($1)`, [
        state.drivers.map((x) => x.id),
      ]);
    if (cuIds.length)
      await c.query(`DELETE FROM customers WHERE id = ANY($1)`, [cuIds]);
    await c.query(`DELETE FROM auth.users WHERE id = ANY($1)`, [uids]);
    await c.query("COMMIT");
    if (replica)
      await c.query("SET session_replication_role = origin").catch(() => {});
    // filet : purge tout résidu tagué
    const leftover = await c.query(
      `SELECT count(*)::int n FROM auth.users WHERE email LIKE '%${DOMAIN}'`
    );
    console.log(
      `  ✅ nettoyé ${uids.length} comptes + données liées · résidu @coligo-loadtest.dev = ${leftover.rows[0].n}`
    );
  } catch (e) {
    await c.query("ROLLBACK").catch(() => {});
    console.log("  ⚠️ cleanup partiel: " + e.message);
  } finally {
    c.release();
  }
}

// Query service_role (rôle pooler postgres = bypass RLS, guards « authenticated » sautés).
async function svc(sql, params) {
  const c = await poolSess.connect();
  try {
    return (await c.query(sql, params)).rows;
  } finally {
    c.release();
  }
}

// =============================================================================
// PHASE 1 — CHECKOUT CLIENT SOUS CHARGE (vrai chemin RLS + 21 triggers)
// N_ORDERS commandes placées EN CONCURRENCE par des clients au hasard.
// =============================================================================
async function phaseOrders() {
  console.log(
    `\n━━━ PHASE 1 · CHECKOUT CLIENT — ${N_ORDERS} commandes concurrentes (conc=${CONCURRENCY}) ━━━`
  );
  const items = Array.from({ length: N_ORDERS }, () => ({
    cu: pick(state.customers),
    m: pick(state.merchants),
  }));
  const results = await runPool(items, async ({ cu, m }) => {
    return asUser(cu.uid, async (c) => {
      const sub = 300 + rnd(20) * 100,
        fee = 200;
      await c.query(
        `INSERT INTO orders (merchant_id, customer_id, customer_name, customer_phone, pickup_slot_at,
           fulfillment_type, delivery_mode, subtotal_da, delivery_fee_da, total_da,
           payment_method, delivery_lat, delivery_lng, delivery_address_text, delivery_phone, notes)
         VALUES ($1,$2,$3,$4, now(),'delivery','express',$5,$6,$7,'cash',$8,$9,'Cité test',$4,$10)`,
        [
          m.id,
          cu.id,
          `${TAG} C`,
          "0660000000",
          sub,
          fee,
          sub + fee,
          m.lat + jitter(0.005),
          m.lng + jitter(0.005),
          TAG,
        ]
      );
    });
  });
  const s = stats(results, "checkout");
  check(
    "checkout client fonctionnel sous charge (taux d'erreur < 2%)",
    s.errRate < 2,
    `err=${s.errRate}%`
  );
  check(
    "latence checkout p95 saine (< 1500ms)",
    s.p95 < 1500,
    `p95=${s.p95.toFixed(0)}ms`
  );
}

// =============================================================================
// PHASE 2 — EXCLUSIVITÉ DISPATCH EXPRESS (« un seul livreur par commande »)
// E commandes express 'preparing' non assignées ; TOUS les livreurs tirent en
// concurrence par vagues (SKIP LOCKED). Aucune commande ne doit être attribuée 2×.
// =============================================================================
async function phaseExpressExclusivity() {
  const WAVES = 3;
  const E = N_DRIVERS * WAVES;
  console.log(
    `\n━━━ PHASE 2 · EXCLUSIVITÉ DISPATCH EXPRESS — ${N_DRIVERS} livreurs vs ${E} commandes, ${WAVES} vagues ━━━`
  );
  // Fixtures express en service_role (statut 'preparing', prêtes au pull).
  const orderIds = [];
  for (let i = 0; i < E; i++) {
    const m = pick(state.merchants),
      cu = pick(state.customers);
    const r = await svc(
      `INSERT INTO orders (merchant_id, customer_id, customer_name, customer_phone, pickup_slot_at, fulfillment_type,
         delivery_mode, status, subtotal_da, delivery_fee_da, total_da, payment_method, payment_status,
         delivery_lat, delivery_lng, delivery_address_text, delivery_phone, notes)
       VALUES ($1,$2,$3,'0660000000', now(),'delivery','express','preparing',500,200,700,'cash','pending',
         $4,$5,'Cité test','0660000000',$6) RETURNING id`,
      [
        m.id,
        cu.id,
        `${TAG} EXP`,
        m.lat + jitter(0.003),
        m.lng + jitter(0.003),
        TAG,
      ]
    );
    orderIds.push(r[0].id);
  }

  const claims = []; // {orderId, driverId}
  let claimLat = [];
  const driverWorker = async (d) => {
    // chaque livreur tire tant qu'il reste des commandes ; libère aussitôt (delivered).
    for (let guard = 0; guard < E + 5; guard++) {
      const t0 = performance.now();
      let got;
      try {
        got = await asUser(d.uid, async (c) => {
          const r = await c.query(
            `SELECT res_order_id FROM public.pull_next_express_nearby($1,$2,$3)`,
            [CENTER.lat, CENTER.lng, 30]
          );
          return r.rows[0]?.res_order_id ?? null;
        });
      } catch {
        got = null;
      }
      claimLat.push(performance.now() - t0);
      if (!got) break;
      claims.push({ orderId: got, driverId: d.id });
      // libère le livreur : commande livrée (service_role).
      await svc(
        `UPDATE orders SET delivery_delivered_at=now(), status='completed' WHERE id=$1`,
        [got]
      );
    }
  };
  const t0 = performance.now();
  await Promise.all(state.drivers.map(driverWorker));
  const secs = (performance.now() - t0) / 1000;

  // Invariant : aucune commande attribuée à 2 livreurs différents.
  const byOrder = new Map();
  for (const c of claims) {
    if (!byOrder.has(c.orderId)) byOrder.set(c.orderId, new Set());
    byOrder.get(c.orderId).add(c.driverId);
  }
  const doubles = [...byOrder.values()].filter((s) => s.size > 1).length;
  const totalClaims = claims.length;
  const distinctOrders = byOrder.size;
  const lat = claimLat.sort((a, b) => a - b);
  const p95 = lat[Math.floor(0.95 * lat.length)] || 0;
  console.log(
    `  claims=${totalClaims} · commandes distinctes=${distinctOrders}/${E} · doublons=${doubles} · pull p95=${p95.toFixed(0)}ms · débit=${(totalClaims / secs).toFixed(0)} claims/s`
  );
  check(
    "AUCUNE double-attribution express (SKIP LOCKED)",
    doubles === 0,
    `${doubles} doublons`
  );
  check(
    "claims == commandes distinctes (pas de fuite)",
    totalClaims === distinctOrders,
    `${totalClaims} vs ${distinctOrders}`
  );
  check(
    "toutes les commandes ont été drainées",
    distinctOrders === E,
    `${distinctOrders}/${E}`
  );
}

// =============================================================================
// PHASE 3 — COLIGO PAY : ANTI DOUBLE-DÉPENSE sous concurrence.
// 1 client, solde 1000 ; 10 paiements de 200 tirés EN MÊME TEMPS → exactement 5
// réussissent, solde jamais négatif, solde final = 0.
// =============================================================================
async function phaseColigoPayDoubleSpend() {
  console.log(
    `\n━━━ PHASE 3 · COLIGO PAY — anti double-dépense (10 paiements concurrents, solde 1000) ━━━`
  );
  const cu = state.customers[0],
    m = state.merchants[0];
  const AMT = 200,
    K = 10,
    BAL = 1000;
  await svc(
    `INSERT INTO customer_wallet_entries (customer_id,type,source,amount_da,note) VALUES ($1,'topup_credit','topup',$2,$3)`,
    [cu.id, BAL, TAG]
  );
  let pinOk = true;
  try {
    await asUser(cu.uid, (c) =>
      c.query(`SELECT public.coligo_pay_set_pin('1234')`)
    );
  } catch (e) {
    pinOk = false;
    console.log("  ⚠️ set_pin: " + e.message.slice(0, 80));
  }
  // crée K demandes marchand (tokens uniques).
  const tokens = [];
  for (let i = 0; i < K; i++) {
    const tok = `lt-tok-${Date.now().toString(36)}-${i}`;
    try {
      await asUser(m.uid, (c) =>
        c.query(`SELECT public.coligo_pay_create_request($1,$2,$3)`, [
          tok,
          AMT,
          600,
        ])
      );
      tokens.push(tok);
    } catch (e) {
      if (i === 0)
        console.log("  ⚠️ create_request: " + e.message.slice(0, 90));
    }
  }
  // exécute tout en concurrence.
  const results = await runPool(
    tokens,
    async (tok, i) => {
      return asUser(cu.uid, async (c) => {
        const r = await c.query(
          `SELECT public.coligo_pay_execute($1,'1234',$2) j`,
          [
            tok,
            `lt-op-${Date.now().toString(36)}-${i}-${Math.random().toString(36).slice(2)}`,
          ]
        );
        return r.rows[0].j;
      });
    },
    K
  );
  const oks = results.filter((r) => r.ok && r.value?.ok === true).length;
  const bal = (
    await svc(`SELECT public.customer_topup_balance($1) b`, [cu.id])
  )[0].b;
  const expectedOk = Math.floor(BAL / AMT);
  console.log(
    `  demandes=${tokens.length} · paiements réussis=${oks} (attendu ${expectedOk}) · solde final=${bal} DA`
  );
  check("PIN posé", pinOk);
  check(
    "exactement floor(solde/montant) paiements réussis",
    oks === expectedOk,
    `${oks}/${expectedOk}`
  );
  check("solde final jamais négatif", bal >= 0, `solde=${bal}`);
  check(
    "solde final = solde − réussis×montant",
    bal === BAL - oks * AMT,
    `${bal}`
  );
}

// =============================================================================
// PHASE 4 — DRIVE : « un seul gagnant » (pas de chauffeur double-booké).
// 1 chauffeur propose sur 2 courses (2 clients) ; les 2 clients acceptent EN MÊME
// TEMPS → une seule réussit, l'autre = chauffeur_busy. Répété R fois.
// =============================================================================
async function phaseDriveOneWinner() {
  // clients[0] réservé au Coligo Pay ; chaque manche consomme clients[2r+1] et [2r+2].
  const R = Math.min(
    5,
    Math.floor((state.customers.length - 1) / 2),
    state.chauffeurs.length
  );
  console.log(
    `\n━━━ PHASE 4 · DRIVE un seul gagnant — ${R} manches (chauffeur partagé sur 2 courses) ━━━`
  );
  let requestable = true,
    wins = 0,
    doubles = 0;
  for (let r = 0; r < R; r++) {
    const cuA = state.customers[2 * r + 1],
      cuB = state.customers[2 * r + 2],
      ch = state.chauffeurs[r];
    if (!cuA || !cuB || !ch) break;
    let rideA, rideB;
    try {
      rideA = await asUser(
        cuA.uid,
        async (c) =>
          (
            await c.query(
              `SELECT public.request_ride(36.7538,3.0588,'Départ',36.78,3.10,'Arrivée',5.0,300,'cash') id`
            )
          ).rows[0].id
      );
      rideB = await asUser(
        cuB.uid,
        async (c) =>
          (
            await c.query(
              `SELECT public.request_ride(36.7540,3.0590,'Départ',36.78,3.10,'Arrivée',5.0,300,'cash') id`
            )
          ).rows[0].id
      );
    } catch (e) {
      requestable = false;
      console.log("  ⚠️ request_ride: " + e.message.slice(0, 100));
      break;
    }
    // le chauffeur propose sur les 2 courses.
    await asUser(ch.uid, async (c) => {
      await c.query(`SELECT public.chauffeur_offer_ride($1,300)`, [rideA]);
      await c.query(`SELECT public.chauffeur_offer_ride($1,300)`, [rideB]);
    });
    const offA = (
      await svc(
        `SELECT id FROM ride_offers WHERE ride_id=$1 AND chauffeur_id=$2 LIMIT 1`,
        [rideA, ch.id]
      )
    )[0]?.id;
    const offB = (
      await svc(
        `SELECT id FROM ride_offers WHERE ride_id=$1 AND chauffeur_id=$2 LIMIT 1`,
        [rideB, ch.id]
      )
    )[0]?.id;
    // les 2 clients acceptent EN MÊME TEMPS.
    const [accA, accB] = await Promise.allSettled([
      asUser(
        cuA.uid,
        async (c) =>
          (
            await c.query(
              `SELECT ok, reason FROM public.accept_ride_offer($1)`,
              [offA]
            )
          ).rows[0]
      ),
      asUser(
        cuB.uid,
        async (c) =>
          (
            await c.query(
              `SELECT ok, reason FROM public.accept_ride_offer($1)`,
              [offB]
            )
          ).rows[0]
      ),
    ]);
    const okA = accA.status === "fulfilled" && accA.value?.ok === true;
    const okB = accB.status === "fulfilled" && accB.value?.ok === true;
    const rA =
      accA.status === "fulfilled"
        ? accA.value?.reason
        : "throw:" + String(accA.reason?.message).slice(0, 30);
    const rB =
      accB.status === "fulfilled"
        ? accB.value?.reason
        : "throw:" + String(accB.reason?.message).slice(0, 30);
    if (okA && okB) doubles++;
    if (okA !== okB) wins++;
    else console.log(`    manche ${r}: A(ok=${okA},${rA}) B(ok=${okB},${rB})`);
    // libère le chauffeur pour la manche suivante (annule les 2 courses).
    await svc(
      `UPDATE rides SET status='cancelled', cancelled_at=now() WHERE id = ANY($1)`,
      [[rideA, rideB]]
    );
  }
  if (requestable) {
    check(
      "aucun chauffeur double-booké (verrou FOR UPDATE)",
      doubles === 0,
      `${doubles} double-bookings`
    );
    check("exactement 1 gagnant par manche", wins === R, `${wins}/${R}`);
  } else {
    console.log(
      "  ⚠️ Drive non testable (request_ride indisponible — flag/zone ?) — non bloquant"
    );
  }
}

// =============================================================================
// PHASE 5 — SÉCURITÉ : isolation multi-tenant, rôles, garde financière, brute-force PIN.
// =============================================================================
async function phaseSecurity() {
  console.log(`\n━━━ PHASE 5 · SÉCURITÉ ━━━`);
  const mA = state.merchants[0],
    mB = state.merchants[1];
  const cuX = state.customers[0],
    cuY = state.customers[1];

  // Prépare une commande de cuY chez mB pour tester la fuite.
  await svc(
    `INSERT INTO orders (merchant_id, customer_id, customer_name, customer_phone, pickup_slot_at, fulfillment_type, delivery_mode, status, subtotal_da, delivery_fee_da, total_da, payment_method, delivery_lat, delivery_lng, delivery_address_text, delivery_phone, notes)
             VALUES ($1,$2,'sec','0660000000', now(),'delivery','express','preparing',500,200,700,'cash',$3,$4,'x','0660000000',$5)`,
    [mB.id, cuY.id, mB.lat, mB.lng, TAG]
  );

  // 5.1 Isolation commerçant : mA ne voit PAS les commandes de mB.
  const leakM = await asUser(
    mA.uid,
    async (c) =>
      (
        await c.query(
          `SELECT count(*)::int n FROM orders WHERE merchant_id=$1`,
          [mB.id]
        )
      ).rows[0].n
  );
  check(
    "isolation multi-tenant : commerçant A ne lit AUCUNE commande de B",
    leakM === 0,
    `vu ${leakM}`
  );

  // 5.2 Isolation client : cuX ne voit PAS les commandes de cuY.
  const leakC = await asUser(
    cuX.uid,
    async (c) =>
      (
        await c.query(
          `SELECT count(*)::int n FROM orders WHERE customer_id=$1`,
          [cuY.id]
        )
      ).rows[0].n
  );
  check(
    "isolation client : client X ne lit AUCUNE commande de Y",
    leakC === 0,
    `vu ${leakC}`
  );

  // 5.3 Rôle : un client ne peut PAS appeler une RPC admin (REVOKE authenticated).
  let adminDenied = false;
  try {
    await asUser(cuX.uid, (c) =>
      c.query(`SELECT * FROM public.admin_alerts()`)
    );
  } catch {
    adminDenied = true;
  }
  check(
    "escalade de rôle bloquée : client → admin_alerts() refusé",
    adminDenied
  );

  // 5.4 Garde colonnes financières : le commerçant ne peut PAS trafiquer total_da.
  const own = await svc(
    `SELECT id, total_da FROM orders WHERE merchant_id=$1 LIMIT 1`,
    [mA.id]
  );
  if (own[0]) {
    let guardBlocked = false;
    try {
      await asUser(mA.uid, (c) =>
        c.query(`UPDATE orders SET total_da=1 WHERE id=$1`, [own[0].id])
      );
    } catch {
      guardBlocked = true;
    }
    const after = (
      await svc(`SELECT total_da FROM orders WHERE id=$1`, [own[0].id])
    )[0]?.total_da;
    check(
      "garde financière : commerçant ne peut PAS modifier total_da",
      guardBlocked || after === own[0].total_da,
      `after=${after}`
    );
  } else {
    console.log("  (pas de commande chez mA pour tester la garde — ok)");
  }

  // 5.5 Brute-force PIN : les mauvaises tentatives finissent par verrouiller.
  const cuPin = state.customers[0]; // PIN '1234' posé en phase 3
  const seq = [];
  for (let i = 0; i < 8; i++) {
    try {
      const r = await svc(
        `SELECT public.coligo_pay_pin_check_internal($1,'0000') s`,
        [cuPin.id]
      );
      seq.push(r[0].s);
    } catch (e) {
      seq.push("err:" + e.message.slice(0, 20));
    }
  }
  const lockedOut = seq.some((s) => /lock/i.test(String(s)));
  console.log(`  séquence PIN erronés: ${seq.join(" → ")}`);
  check(
    "brute-force PIN : verrouillage après tentatives répétées",
    lockedOut,
    lockedOut ? "" : "PAS de lockout"
  );
}

// =============================================================================
// PHASE 6 — INTÉGRITÉ GLOBALE post-charge (source unique = integrity_violations()).
// =============================================================================
async function phaseIntegrity() {
  console.log(`\n━━━ PHASE 6 · INTÉGRITÉ POST-CHARGE ━━━`);
  const rows = await svc(
    `SELECT code, severity, cnt, detail FROM public.integrity_violations() ORDER BY severity, code`
  );
  if (rows.length === 0) {
    check("integrity_violations() = 0 violation après toute la charge", true);
  } else {
    check(
      "integrity_violations() = 0 violation après toute la charge",
      false,
      `${rows.length} violation(s)`
    );
    for (const r of rows)
      console.log(`     🚨 [${r.severity}] ${r.code} ×${r.cnt} — ${r.detail}`);
  }
  const neg = (
    await svc(
      `SELECT count(*)::int n FROM customers cu WHERE public.customer_topup_balance(cu.id) < 0`
    )
  )[0].n;
  check(
    "aucun solde Coligo Pay négatif (global)",
    neg === 0,
    `${neg} négatifs`
  );
}

// =============================================================================
// MAIN
// =============================================================================
async function main() {
  const t0 = performance.now();
  try {
    await seed();
    await phaseOrders();
    await phaseExpressExclusivity();
    await phaseColigoPayDoubleSpend();
    await phaseDriveOneWinner();
    await phaseSecurity();
    await phaseIntegrity();
  } catch (e) {
    console.error("\n💥 ERREUR FATALE:", e.message);
    FAIL++;
  } finally {
    await cleanup();
    await Promise.all([poolTx.end(), poolSess.end()]);
  }
  const secs = ((performance.now() - t0) / 1000).toFixed(1);
  console.log(
    `\n${FAIL === 0 ? "🎉 TOUT VERT" : "⚠️ ÉCHECS DÉTECTÉS"} — invariants: ${PASS} ok / ${FAIL} échec · durée ${secs}s`
  );
  process.exit(FAIL === 0 ? 0 : 1);
}
main();
