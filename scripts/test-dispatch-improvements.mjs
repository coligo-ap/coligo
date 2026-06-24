/**
 * Banc de tests des AMÉLIORATIONS DISPATCH (scalabilité push), bout en bout sur
 * la prod avec données temporaires NETTOYÉES. Une section par amélioration :
 *
 *   A. KNN PostGIS (mig 0253) — chauffeur_dispatch_knn : tri distance, exclut
 *      hors-ligne / périmé / non vérifié / occupé / hors rayon.
 *   B. present_near PostGIS (mig 0256) — matching gamme, favoris, exclusions,
 *      index GiST (EXPLAIN).
 *   C. Canaux PRIVÉS (mig 0254) — chauffeur & livreur reçoivent leur canal,
 *      isolation (un autre est refusé).
 *   D. Re-dispatch escaladé (mig 0255) — drive_escalate_dispatch : ownership,
 *      bump +5, anti-rafale, plafond, statut.
 *   E. Broadcast HTTP (lib/realtime/broadcast) — 202 sur topics privés.
 *
 * Lancement : npm run test:dispatch:improvements
 */
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const env = readFileSync(join(ROOT, ".env.local"), "utf8");
const get = (k) => {
  const m = env.match(new RegExp("^\\s*" + k + "\\s*=\\s*(.*)\\s*$", "m"));
  let v = m ? m[1] : "";
  if (
    (v.startsWith('"') && v.endsWith('"')) ||
    (v.startsWith("'") && v.endsWith("'"))
  )
    v = v.slice(1, -1);
  return v;
};
const URL = get("NEXT_PUBLIC_SUPABASE_URL");
const ANON = get("NEXT_PUBLIC_SUPABASE_ANON_KEY");
const SVC = get("SUPABASE_SERVICE_ROLE_KEY");
const admin = createClient(URL, SVC, { auth: { persistSession: false } });
const PW = "Disp-E2E-123!";
const A = { lat: 36.7538, lng: 3.0588 }; // Alger
const off = (km) => A.lat + km / 111; // décalage latitude ≈ km

let pass = 0,
  fail = 0;
const check = (label, cond) => {
  if (cond) pass++;
  else fail++;
  console.log(`${cond ? "✅" : "❌"} ${label}`);
};

// Suivi des entités créées (nettoyage en ordre de dépendance).
const reg = { users: [], chauffeurs: [], customers: [], rides: [] };

async function newUser(tag) {
  const email = `dispimp-${tag}-${Date.now()}-${Math.random().toString(36).slice(2, 6)}@example.com`;
  const { data, error } = await admin.auth.admin.createUser({
    email,
    password: PW,
    email_confirm: true,
  });
  if (error) throw new Error("createUser " + error.message);
  reg.users.push(data.user.id);
  return { uid: data.user.id, email };
}

async function newChauffeur(opts = {}) {
  const {
    lat = A.lat,
    lng = A.lng,
    online = true,
    verified = true,
    frozen = false,
    gamme = "classic",
    ageSecs = 0,
  } = opts;
  const u = await newUser("ch");
  const phone = "07" + Math.floor(10000000 + Math.random() * 89999999);
  const { data: ch, error } = await admin
    .from("chauffeurs")
    .insert({
      user_id: u.uid,
      full_name: "Imp Ch",
      phone,
      gamme,
      is_verified: verified,
      is_frozen: frozen,
      is_blocked: false,
    })
    .select("id")
    .single();
  if (error) throw new Error("insert chauffeur " + error.message);
  reg.chauffeurs.push(ch.id);
  await admin.from("chauffeur_presence").upsert({
    chauffeur_id: ch.id,
    lat,
    lng,
    is_online: online,
    updated_at: new Date(Date.now() - ageSecs * 1000).toISOString(),
  });
  return { uid: u.uid, email: u.email, chauffeurId: ch.id };
}

async function newCustomer() {
  const u = await newUser("cu");
  const { data: cu, error } = await admin
    .from("customers")
    .insert({ user_id: u.uid, full_name: "Imp Cust" })
    .select("id")
    .single();
  if (error) throw new Error("insert customer " + error.message);
  reg.customers.push(cu.id);
  return { uid: u.uid, email: u.email, customerId: cu.id };
}

async function newRide(
  customerId,
  { chauffeurId = null, status = "searching" } = {}
) {
  const { data: r, error } = await admin
    .from("rides")
    .insert({
      customer_id: customerId,
      chauffeur_id: chauffeurId,
      status,
      pickup_lat: A.lat,
      pickup_lng: A.lng,
      dest_lat: A.lat + 0.05,
      dest_lng: A.lng + 0.05,
    })
    .select("id")
    .single();
  if (error) throw new Error("insert ride " + error.message);
  reg.rides.push(r.id);
  return r.id;
}

const rpcAdmin = admin.rpc.bind(admin);

const broadcast = async (topic) => {
  const r = await fetch(URL + "/realtime/v1/api/broadcast", {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      apikey: SVC,
      Authorization: "Bearer " + SVC,
    },
    body: JSON.stringify({
      messages: [{ topic, event: "new_ride", payload: {}, private: true }],
    }),
  });
  return r.status;
};

async function subRecv(email, topic, event, fire) {
  const sb = createClient(URL, ANON, { auth: { persistSession: false } });
  await sb.auth.signInWithPassword({ email, password: PW });
  return await new Promise((resolve) => {
    let got = false;
    const ch = sb.channel(topic, { config: { private: true } });
    ch.on("broadcast", { event }, () => (got = true)).subscribe(async (s) => {
      if (s === "SUBSCRIBED") {
        if (fire) await fire();
        setTimeout(async () => {
          await sb.removeAllChannels();
          resolve({ s, got });
        }, 1500);
      } else if (s === "CHANNEL_ERROR" || s === "TIMED_OUT")
        resolve({ s, got: false });
    });
  });
}

async function cleanup() {
  for (const id of reg.rides) await admin.from("rides").delete().eq("id", id);
  for (const id of reg.chauffeurs) {
    await admin.from("chauffeur_presence").delete().eq("chauffeur_id", id);
    await admin
      .from("customer_favorite_chauffeurs")
      .delete()
      .eq("chauffeur_id", id);
    await admin.from("chauffeurs").delete().eq("id", id);
  }
  for (const id of reg.customers)
    await admin.from("customers").delete().eq("id", id);
  for (const id of reg.users) await admin.auth.admin.deleteUser(id);
}

async function main() {
  try {
    // ─────────────────────────────────────────────────────────────────────
    console.log("\n=== A. KNN PostGIS (chauffeur_dispatch_knn, mig 0253) ===");
    const near = await newChauffeur({ lat: A.lat }); // 0 km
    const far = await newChauffeur({ lat: off(4) }); // ~4 km
    const offline = await newChauffeur({ online: false });
    const stale = await newChauffeur({ ageSecs: 600 }); // périmé (>60s)
    const unverif = await newChauffeur({ verified: false });
    const beyond = await newChauffeur({ lat: off(16) }); // ~16 km
    const busy = await newChauffeur({ lat: off(1) });
    const cust0 = await newCustomer();
    await newRide(cust0.customerId, {
      chauffeurId: busy.chauffeurId,
      status: "in_progress",
    });

    const { data: knn } = await rpcAdmin("chauffeur_dispatch_knn", {
      p_lat: A.lat,
      p_lng: A.lng,
      p_limit: 50,
      p_max_km: 10,
      p_fresh_secs: 60,
    });
    const kIds = (knn ?? []).map((r) => r.chauffeur_id);
    const kSet = new Set(kIds);
    check("inclut le chauffeur PROCHE", kSet.has(near.chauffeurId));
    check("inclut le chauffeur à ~4 km", kSet.has(far.chauffeurId));
    check(
      "tri par distance (proche avant lointain)",
      kIds.indexOf(near.chauffeurId) < kIds.indexOf(far.chauffeurId)
    );
    check("exclut HORS LIGNE", !kSet.has(offline.chauffeurId));
    check("exclut position PÉRIMÉE (fresh_secs)", !kSet.has(stale.chauffeurId));
    check("exclut NON VÉRIFIÉ", !kSet.has(unverif.chauffeurId));
    check("exclut OCCUPÉ (course active)", !kSet.has(busy.chauffeurId));
    check("exclut HORS RAYON (16 km > max 10)", !kSet.has(beyond.chauffeurId));

    const { data: knnWide } = await rpcAdmin("chauffeur_dispatch_knn", {
      p_lat: A.lat,
      p_lng: A.lng,
      p_limit: 50,
      p_max_km: 30,
      p_fresh_secs: 60,
    });
    check(
      "le HORS RAYON réapparaît avec max 30 km",
      new Set((knnWide ?? []).map((r) => r.chauffeur_id)).has(
        beyond.chauffeurId
      )
    );

    // ─────────────────────────────────────────────────────────────────────
    console.log(
      "\n=== B. present_near PostGIS (gamme/favoris/index, mig 0256) ==="
    );
    const classic = await newChauffeur({ gamme: "classic", lat: off(0.2) });
    const confort = await newChauffeur({ gamme: "confort", lat: off(0.3) });
    const moto = await newChauffeur({ gamme: "moto", lat: off(0.4) });
    const favCust = await newCustomer();
    await admin.from("customer_favorite_chauffeurs").insert({
      customer_id: favCust.customerId,
      chauffeur_id: classic.chauffeurId,
    });
    const { data: pn } = await rpcAdmin("chauffeurs_present_near", {
      p_lat: A.lat,
      p_lng: A.lng,
      p_radius_km: 30,
      p_within_min: 999999,
      p_gamme: "classic",
      p_female_only: false,
      p_customer_id: favCust.customerId,
    });
    const pnById = new Map((pn ?? []).map((r) => [r.chauffeur_id, r]));
    check(
      "requête 'classic' → chauffeur CLASSIC inclus",
      pnById.has(classic.chauffeurId)
    );
    check(
      "requête 'classic' → chauffeur CONFORT inclus (reçoit classic)",
      pnById.has(confort.chauffeurId)
    );
    check(
      "requête 'classic' → chauffeur MOTO exclu",
      !pnById.has(moto.chauffeurId)
    );
    check(
      "favori du client marqué is_favorite",
      pnById.get(classic.chauffeurId)?.is_favorite === true
    );
    check(
      "non-favori non marqué",
      pnById.get(confort.chauffeurId)?.is_favorite === false
    );

    // index GiST réellement utilisé
    const { rows: ex } = await pgExplain();
    const usesIndex = ex.some((l) => /idx_chauffeur_presence_geog/.test(l));
    check(
      "EXPLAIN utilise l'index GiST idx_chauffeur_presence_geog",
      usesIndex
    );

    // ─────────────────────────────────────────────────────────────────────
    console.log(
      "\n=== C. Canaux PRIVÉS (Realtime Authorization, mig 0254) ==="
    );
    const chRt = await newChauffeur();
    const otherUser = await newUser("oth");
    const rcvOwn = await subRecv(
      chRt.email,
      `chauffeur:${chRt.uid}`,
      "new_ride",
      () => broadcast(`chauffeur:${chRt.uid}`)
    );
    check("CHAUFFEUR reçoit son canal privé", rcvOwn.got === true);
    const rcvOther = await subRecv(
      otherUser.email,
      `chauffeur:${chRt.uid}`,
      "new_ride",
      () => broadcast(`chauffeur:${chRt.uid}`)
    );
    check(
      "un AUTRE user est refusé sur ce canal (isolation)",
      rcvOther.got === false && rcvOther.s === "CHANNEL_ERROR"
    );
    const courierUser = await newUser("cou");
    const rcvCourier = await subRecv(
      courierUser.email,
      `courier:${courierUser.uid}`,
      "new_express",
      async () => {
        const r = await fetch(URL + "/realtime/v1/api/broadcast", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            apikey: SVC,
            Authorization: "Bearer " + SVC,
          },
          body: JSON.stringify({
            messages: [
              {
                topic: `courier:${courierUser.uid}`,
                event: "new_express",
                payload: {},
                private: true,
              },
            ],
          }),
        });
        return r.status;
      }
    );
    check(
      "LIVREUR reçoit son canal privé courier:{uid}",
      rcvCourier.got === true
    );

    // ─────────────────────────────────────────────────────────────────────
    console.log(
      "\n=== D. Re-dispatch escaladé (drive_escalate_dispatch, mig 0255) ==="
    );
    const { data: settings } = await admin
      .from("platform_settings")
      .select("drive_default_radius_km")
      .eq("id", true)
      .maybeSingle();
    const defRadius = Math.min(
      20,
      Math.max(5, Number(settings?.drive_default_radius_km ?? 10))
    );
    const escCust = await newCustomer();
    const rideId = await newRide(escCust.customerId, { status: "searching" });

    // non-owner → null
    const strangerSb = createClient(URL, ANON, {
      auth: { persistSession: false },
    });
    await strangerSb.auth.signInWithPassword({
      email: otherUser.email,
      password: PW,
    });
    const { data: nonOwner } = await strangerSb.rpc("drive_escalate_dispatch", {
      p_ride_id: rideId,
    });
    check("non-propriétaire → NULL (ownership)", nonOwner === null);

    // owner first → bump
    const ownerSb = createClient(URL, ANON, {
      auth: { persistSession: false },
    });
    await ownerSb.auth.signInWithPassword({
      email: escCust.email,
      password: PW,
    });
    const { data: first } = await ownerSb.rpc("drive_escalate_dispatch", {
      p_ride_id: rideId,
    });
    check(
      `1ʳᵉ escalade → rayon ${defRadius}+5 = ${defRadius + 5}`,
      first === defRadius + 5
    );

    // immediate second → anti-rafale null
    const { data: second } = await ownerSb.rpc("drive_escalate_dispatch", {
      p_ride_id: rideId,
    });
    check("2ᵉ escalade immédiate → NULL (anti-rafale 25 s)", second === null);

    // cap : forcer 25 + last_dispatch_at ancien → null
    await admin
      .from("rides")
      .update({
        dispatch_radius_km: 25,
        last_dispatch_at: new Date(Date.now() - 60000).toISOString(),
      })
      .eq("id", rideId);
    const { data: capped } = await ownerSb.rpc("drive_escalate_dispatch", {
      p_ride_id: rideId,
    });
    check("au plafond 25 km → NULL", capped === null);

    // not searching → null
    await admin
      .from("rides")
      .update({
        status: "completed",
        dispatch_radius_km: null,
        last_dispatch_at: null,
      })
      .eq("id", rideId);
    const { data: notSearch } = await ownerSb.rpc("drive_escalate_dispatch", {
      p_ride_id: rideId,
    });
    check("course non 'searching' → NULL", notSearch === null);

    // ─────────────────────────────────────────────────────────────────────
    console.log("\n=== E. Broadcast HTTP (private) ===");
    check(
      "broadcast chauffeur:{uid} → 202",
      (await broadcast(`chauffeur:${chRt.uid}`)) === 202
    );
    check(
      "broadcast courier:{uid} → 202",
      (await broadcast(`courier:${courierUser.uid}`)) === 202
    );
  } catch (e) {
    fail++;
    console.error("❌ ERREUR:", e.message, e.stack);
  } finally {
    await cleanup();
    console.log("\n— cleanup done —");
  }
  console.log(
    `\n${fail === 0 ? "✅ TOUT VERT" : "❌ ÉCHECS"} : ${pass}/${pass + fail}`
  );
  process.exit(fail === 0 ? 0 : 1);
}

// EXPLAIN via pg direct (le planner doit choisir l'index GiST).
async function pgExplain() {
  const pg = (await import("pg")).default;
  const { getDbUrl } = await import("./_supabase.mjs");
  const c = new pg.Client({
    connectionString: getDbUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await c.connect();
  const r = await c.query(
    "EXPLAIN SELECT 1 FROM public.chauffeur_presence p WHERE extensions.ST_DWithin(p.geog, extensions.ST_SetSRID(extensions.ST_MakePoint($1,$2),4326)::extensions.geography, 30000)",
    [A.lng, A.lat]
  );
  await c.end();
  return { rows: r.rows.map((x) => x["QUERY PLAN"]) };
}

main();
