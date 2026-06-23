// =============================================================================
// Test DISPATCH chauffeur (Coligo Drive) — réponses aux questions :
//  1) Un chauffeur reçoit-il TOUTES les courses même si les départs sont très
//     loin ? → NON : centré sur sa position live, rayon 3..20 km + expansion
//     auto (les v_min plus proches au-delà), JAMAIS au-delà de 20 km.
//  2) Avec « Je rentre chez moi » actif, reçoit-il les courses dont l'arrivée ne
//     va PAS vers son domicile ? → NON : filtre client isTowardsHome les masque.
//
// On teste le VRAI RPC `chauffeur_nearby_rides` (impersonation chauffeur) sur des
// données synthétiques (30 courses réparties en zones), avec un ORACLE calculé
// depuis le `km_between` de la base elle-même → robuste aux approximations.
// La fonction « rentrer chez moi » (isTowardsHome) est testée telle quelle.
//
// Tout tourne dans une TRANSACTION rollback : rien ne persiste, aucune notif.
// Lancer : node --experimental-strip-types scripts/test-chauffeur-dispatch.mjs
// =============================================================================
import pg from "pg";
import { getDbUrl } from "./_supabase.mjs";
import { isTowardsHome, bearingDeg, angularDiff } from "../lib/drive/geo.ts";

// Miroir EXACT de isPushEligible (lib/chauffeur/dispatch-filter.ts) — on évite
// d'importer le module aliasé « @/ » (non résolu par node) ; la logique de
// direction repose sur le VRAI isTowardsHome importé ci-dessus.
function isPushEligible(ride, ch) {
  if (ch.radiusKm != null) {
    const r = Math.min(20, Math.max(3, ch.radiusKm));
    if (ch.distKm > r) return false;
  }
  const active = ch.homeDirActive && ch.homeLat != null && ch.homeLng != null;
  if (!active) return true;
  if (
    ride.pickup_lat == null ||
    ride.dest_lat == null ||
    ride.pickup_lng == null ||
    ride.dest_lng == null
  )
    return true;
  return isTowardsHome(
    { lat: ride.pickup_lat, lng: ride.pickup_lng },
    { lat: ride.dest_lat, lng: ride.dest_lng },
    { lat: ch.homeLat, lng: ch.homeLng },
    ch.tolerance
  );
}

const CUST_USER = "00000000-0000-4000-8000-000820591480"; // auth client de test
const CHU_USER = "22222222-2222-4222-8222-222222222222"; // auth chauffeur de test

// Règle serveur (cf. mig 0201).
const V_MAX = 20; // plafond d'expansion (km)
const V_MIN = 6; // nb mini visé avant d'élargir

let pass = 0,
  fail = 0;
const ok = (label, cond, extra = "") => {
  console.log(`${cond ? "✅" : "❌"} ${label}${extra ? " — " + extra : ""}`);
  cond ? pass++ : fail++;
};

// Zones (centres réels DZ).
const ALGER = { lat: 36.7538, lng: 3.0588 };
const ORAN = { lat: 35.6987, lng: -0.6349 };
const CONSTANTINE = { lat: 36.365, lng: 6.6147 };
const ANNABA = { lat: 36.9, lng: 7.7667 };
const GHARDAIA = { lat: 32.4911, lng: 3.6736 };

// Décale un point de ~dLat/dLng degrés.
const off = (p, dLat, dLng = 0) => ({ lat: p.lat + dLat, lng: p.lng + dLng });

// 30 courses : 3 dans la MÊME zone (Alger centre) + 27 ailleurs (anneau autour
// d'Alger à distances croissantes + zones lointaines Oran/Constantine/…).
const RIDES = [
  // 3 dans la même zone (≤ ~1 km d'Alger A).
  { tag: "A-same-1", p: off(ALGER, 0.003, 0.0) },
  { tag: "A-same-2", p: off(ALGER, -0.004, 0.002) },
  { tag: "A-same-3", p: off(ALGER, 0.001, -0.003) },
  // Anneau autour d'Alger (distances croissantes ~2..22 km).
  { tag: "A-2km", p: off(ALGER, 0.018) },
  { tag: "A-4km", p: off(ALGER, 0.036) },
  { tag: "A-6km", p: off(ALGER, 0.054) },
  { tag: "A-8km", p: off(ALGER, 0.072) },
  { tag: "A-10km", p: off(ALGER, 0.09) },
  { tag: "A-12km", p: off(ALGER, 0.108) },
  { tag: "A-14km", p: off(ALGER, 0.126) },
  { tag: "A-18km", p: off(ALGER, 0.162) },
  { tag: "A-22km", p: off(ALGER, 0.2) }, // > 20 km → jamais dispatché
  { tag: "A-44km", p: off(ALGER, 0.4) }, // très loin
  // Oran (≈ 350 km d'Alger) — 6 courses groupées.
  { tag: "ORAN-1", p: off(ORAN, 0.002) },
  { tag: "ORAN-2", p: off(ORAN, -0.003, 0.002) },
  { tag: "ORAN-3", p: off(ORAN, 0.004, -0.001) },
  { tag: "ORAN-4", p: off(ORAN, 0.01) },
  { tag: "ORAN-5", p: off(ORAN, -0.01, 0.01) },
  { tag: "ORAN-6", p: off(ORAN, 0.02, 0.02) },
  // Constantine (≈ 320 km) — 4 courses.
  { tag: "CONST-1", p: off(CONSTANTINE, 0.002) },
  { tag: "CONST-2", p: off(CONSTANTINE, -0.004) },
  { tag: "CONST-3", p: off(CONSTANTINE, 0.01, 0.01) },
  { tag: "CONST-4", p: off(CONSTANTINE, -0.02) },
  // Annaba (≈ 530 km) — 3 courses.
  { tag: "ANNABA-1", p: off(ANNABA, 0.002) },
  { tag: "ANNABA-2", p: off(ANNABA, -0.003) },
  { tag: "ANNABA-3", p: off(ANNABA, 0.01) },
  // Ghardaïa (≈ 470 km) — 4 courses.
  { tag: "GHAR-1", p: off(GHARDAIA, 0.002) },
  { tag: "GHAR-2", p: off(GHARDAIA, -0.004) },
  { tag: "GHAR-3", p: off(GHARDAIA, 0.01) },
  { tag: "GHAR-4", p: off(GHARDAIA, -0.02, 0.01) },
];

const c = new pg.Client({ connectionString: getDbUrl() });
await c.connect();
await c.query("BEGIN");

const asChu = () =>
  c.query(
    `SELECT set_config('request.jwt.claims', json_build_object('sub','${CHU_USER}','role','authenticated')::text, true)`
  );

/** Oracle : ce que le RPC DOIT renvoyer pour une position+rayon donnés. */
function expectedTags(pdistByTag, radius) {
  const elig = Object.entries(pdistByTag)
    .filter(([, d]) => d <= V_MAX) // hors plafond 20 km = jamais
    .sort((a, b) => a[1] - b[1]); // plus proche d'abord
  const r = Math.min(V_MAX, Math.max(3, radius));
  const keep = new Set();
  elig.forEach(([tag, d], i) => {
    if (d <= r || i < V_MIN) keep.add(tag); // dans le rayon OU parmi les v_min plus proches
  });
  return keep;
}

try {
  // Client de test présent ?
  const cust = await c.query(
    "SELECT id FROM customers WHERE user_id=$1 OR id=$1 LIMIT 1",
    [CUST_USER]
  );
  const customerId = cust.rows[0]?.id ?? "60eec155-fb82-4a8b-9223-8ac2dd24d922";

  // Chauffeur de test (vérifié, gamme confort → matche les courses 'classic').
  await c.query(
    `INSERT INTO chauffeurs (user_id, full_name, phone, is_verified, gamme)
     VALUES ($1,'Test Dispatch','+213700000888',true,'confort')`,
    [CHU_USER]
  );

  // 30 courses 'searching' (cash, gamme classic). Insertion directe (on teste le
  // dispatch, pas request_ride qui interdit > 1 course active par client).
  const ids = {};
  for (const { tag, p } of RIDES) {
    const dest = off(p, 0.01, 0.01); // destination quelconque (non filtrée)
    const res = await c.query(
      `INSERT INTO rides (customer_id, status, payment_method, gamme, female_only,
                          pickup_lat, pickup_lng, dest_lat, dest_lng, pickup_text)
       VALUES ($1,'searching','cash','classic',false,$2,$3,$4,$5,$6) RETURNING id`,
      [customerId, p.lat, p.lng, dest.lat, dest.lng, tag]
    );
    ids[tag] = res.rows[0].id;
  }
  ok(
    "30 courses créées (3 même zone + 27 ailleurs)",
    RIDES.length === 30,
    `total=${RIDES.length}`
  );

  // Distances réelles (km_between de la DB) depuis une position donnée.
  async function pdistFrom(pos) {
    const rows = (
      await c.query(
        `SELECT pickup_text tag, km_between($1,$2,pickup_lat,pickup_lng)::numeric d
           FROM rides WHERE id = ANY($3::uuid[])`,
        [pos.lat, pos.lng, Object.values(ids)]
      )
    ).rows;
    const m = {};
    for (const r of rows) m[r.tag] = Number(r.d);
    return m;
  }

  // Appel du VRAI RPC en impersonation chauffeur.
  async function dispatch(pos, radius) {
    await asChu();
    const rows = (
      await c.query("SELECT * FROM chauffeur_nearby_rides($1,$2,$3)", [
        pos.lat,
        pos.lng,
        radius,
      ])
    ).rows;
    return rows;
  }

  // ───────────────────────────────────────────────────────────────────────
  // SCÉNARIO 1 — Chauffeur à Alger, rayon 3 km
  // ───────────────────────────────────────────────────────────────────────
  console.log("\n=== Scénario 1 : chauffeur à ALGER, rayon 3 km ===");
  {
    const pd = await pdistFrom(ALGER);
    const got = await dispatch(ALGER, 3);
    const gotTags = new Set(got.map((r) => r.pickup_text));
    const exp = expectedTags(pd, 3);

    ok(
      "résultat = oracle (rayon 3)",
      setsEqual(gotTags, exp),
      `got={${[...gotTags].sort().join(",")}} exp={${[...exp].sort().join(",")}}`
    );
    // Les 3 de la même zone (≤1 km) toujours présents.
    ok(
      "les 3 courses de la MÊME zone sont reçues",
      ["A-same-1", "A-same-2", "A-same-3"].every((t) => gotTags.has(t))
    );
    // AUCUNE course à > 20 km (Oran/Constantine/Annaba/Ghardaïa/22km/44km).
    const farLeak = got.filter((r) => pd[r.pickup_text] > V_MAX);
    ok(
      "AUCUNE course au-delà de 20 km n'est dispatchée",
      farLeak.length === 0,
      `fuites=${farLeak.map((r) => r.pickup_text).join(",") || "0"}`
    );
    // Pas « toutes les 30 » : le chauffeur n'en voit qu'une poignée.
    ok(
      "le chauffeur NE reçoit PAS les 30 (zone-scopé)",
      got.length < 30,
      `reçues=${got.length}/30`
    );
    console.log(`   → reçues: ${[...gotTags].sort().join(", ")}`);
  }

  // ───────────────────────────────────────────────────────────────────────
  // SCÉNARIO 2 — Chauffeur à Alger, rayon élargi 15 km (plus de courses)
  // ───────────────────────────────────────────────────────────────────────
  console.log("\n=== Scénario 2 : chauffeur à ALGER, rayon 15 km ===");
  {
    const pd = await pdistFrom(ALGER);
    const got3 = await dispatch(ALGER, 3);
    const got15 = await dispatch(ALGER, 15);
    const exp = expectedTags(pd, 15);
    const gotTags = new Set(got15.map((r) => r.pickup_text));
    ok("résultat = oracle (rayon 15)", setsEqual(gotTags, exp));
    ok(
      "élargir le rayon ⇒ plus (ou autant) de courses",
      got15.length >= got3.length,
      `3km=${got3.length} → 15km=${got15.length}`
    );
    const farLeak = got15.filter((r) => pd[r.pickup_text] > V_MAX);
    ok("toujours AUCUNE course > 20 km", farLeak.length === 0);
  }

  // ───────────────────────────────────────────────────────────────────────
  // SCÉNARIO 3 — Chauffeur à Oran : ne voit QUE les courses d'Oran
  // ───────────────────────────────────────────────────────────────────────
  console.log("\n=== Scénario 3 : chauffeur à ORAN, rayon 5 km ===");
  {
    const pd = await pdistFrom(ORAN);
    const got = await dispatch(ORAN, 5);
    const gotTags = new Set(got.map((r) => r.pickup_text));
    const exp = expectedTags(pd, 5);
    ok("résultat = oracle (Oran, rayon 5)", setsEqual(gotTags, exp));
    const onlyOran = [...gotTags].every((t) => t.startsWith("ORAN"));
    ok(
      "ne reçoit QUE des courses d'Oran (pas Alger/Constantine/…)",
      onlyOran,
      `reçues=${[...gotTags].sort().join(",")}`
    );
    ok(
      "ne reçoit AUCUNE course d'Alger",
      ![...gotTags].some((t) => t.startsWith("A-"))
    );
  }

  // ───────────────────────────────────────────────────────────────────────
  // SCÉNARIO 4 — « Je rentre chez moi » (filtre client isTowardsHome)
  // ───────────────────────────────────────────────────────────────────────
  console.log("\n=== Scénario 4 : filtre « Je rentre chez moi » ===");
  {
    const TOL = 45; // tolérance angulaire par défaut (config admin)
    const home = { lat: 36.9, lng: 3.06 }; // domicile au NORD d'Alger
    // Réplique EXACTE de la décision client (d-requests.tsx inDirection).
    const inDirection = (pickup, dest, dirActive) =>
      !dirActive || isTowardsHome(pickup, dest, home, TOL);

    const pickup = { lat: 36.75, lng: 3.06 };
    const destToHome = { lat: 36.87, lng: 3.06 }; // vers le nord = vers la maison
    const destAway = { lat: 36.63, lng: 3.06 }; // vers le sud = à l'opposé
    const destSideways = { lat: 36.75, lng: 3.25 }; // plein est = perpendiculaire

    // Filtre ACTIF.
    ok(
      "course VERS la maison ⇒ reçue",
      inDirection(pickup, destToHome, true) === true
    );
    ok(
      "course À L'OPPOSÉ de la maison ⇒ NON reçue (masquée)",
      inDirection(pickup, destAway, true) === false
    );
    ok(
      "course PERPENDICULAIRE ⇒ NON reçue (hors tolérance)",
      inDirection(pickup, destSideways, true) === false
    );
    // Filtre INACTIF : tout passe.
    ok(
      "filtre désactivé ⇒ course à l'opposé reçue aussi",
      inDirection(pickup, destAway, false) === true
    );
    // Cohérence géométrie.
    ok(
      "cap pickup→maison ≈ Nord (0°/360°)",
      [0, 360].some((b) => angularDiff(bearingDeg(pickup, home), b) < 5)
    );
  }

  // ───────────────────────────────────────────────────────────────────────
  // SCÉNARIO 5 — Éligibilité du PUSH (rayon + « je rentre chez moi »)
  // Même règle que les écrans (isPushEligible) → cohérence push ⇄ liste.
  // ───────────────────────────────────────────────────────────────────────
  console.log("\n=== Scénario 5 : éligibilité du PUSH ===");
  {
    const home = { lat: 36.9, lng: 3.06 }; // domicile au nord
    const rideToHome = {
      pickup_lat: 36.75,
      pickup_lng: 3.06,
      dest_lat: 36.87,
      dest_lng: 3.06,
    };
    const rideAway = {
      pickup_lat: 36.75,
      pickup_lng: 3.06,
      dest_lat: 36.63,
      dest_lng: 3.06,
    };
    const base = {
      homeDirActive: false,
      homeLat: home.lat,
      homeLng: home.lng,
      tolerance: 45,
    };

    // Rayon : départ à 5 km, rayon 3 → exclu ; rayon 10 → inclus ; null → inclus.
    ok(
      "push exclu si départ hors du rayon choisi (5km > 3km)",
      isPushEligible(rideToHome, { ...base, distKm: 5, radiusKm: 3 }) === false
    );
    ok(
      "push inclus si départ dans le rayon (5km ≤ 10km)",
      isPushEligible(rideToHome, { ...base, distKm: 5, radiusKm: 10 }) === true
    );
    ok(
      "rayon non personnalisé (null) ⇒ pas de restriction de rayon",
      isPushEligible(rideToHome, { ...base, distKm: 5, radiusKm: null }) ===
        true
    );
    // « Je rentre chez moi » actif : course à l'opposé = pas de push.
    ok(
      "home-dir actif : push EXCLU pour une course à l'opposé du domicile",
      isPushEligible(rideAway, {
        ...base,
        homeDirActive: true,
        distKm: 1,
        radiusKm: null,
      }) === false
    );
    ok(
      "home-dir actif : push INCLUS pour une course vers le domicile",
      isPushEligible(rideToHome, {
        ...base,
        homeDirActive: true,
        distKm: 1,
        radiusKm: null,
      }) === true
    );
    ok(
      "home-dir inactif : push INCLUS même pour une course à l'opposé",
      isPushEligible(rideAway, {
        ...base,
        homeDirActive: false,
        distKm: 1,
        radiusKm: null,
      }) === true
    );
  }

  console.log(
    `\n${fail === 0 ? "🎉 DISPATCH OK" : "⚠️ ÉCHECS"} — pass=${pass} fail=${fail}`
  );
} catch (e) {
  console.error("ERREUR:", e.message);
  fail++;
} finally {
  await c.query("ROLLBACK");
  await c.end();
}

function setsEqual(a, b) {
  if (a.size !== b.size) return false;
  for (const x of a) if (!b.has(x)) return false;
  return true;
}

process.exit(fail === 0 ? 0 : 1);
