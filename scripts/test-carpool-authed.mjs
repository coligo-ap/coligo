// =============================================================================
// Parcours COVOITURAGE complet en SESSIONS AUTHENTIFIÉES sur la PROD.
//   node scripts/test-carpool-authed.mjs
// Reproduit le chemin RÉEL du client (anon key + signInWithPassword + RPC via
// PostgREST) : GRANTs, RLS, auth.uid(), latence prod — ce que le test pg en
// claims simulées ne couvre pas. Comptes de test permanents (mdp = identifiant,
// JAMAIS modifiés) : chauffeur 0603044618 (Said, Béjaïa) + client qawaexpress.
// Données créées PUIS SUPPRIMÉES (service_role) — zéro trace en fin de script.
// =============================================================================
import { createClient } from "@supabase/supabase-js";
import { readFileSync } from "node:fs";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("="))
    .map((l) => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1)])
);
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SR = env.SUPABASE_SERVICE_ROLE_KEY;

let pass = 0;
let fail = 0;
const ok = (name, cond, extra = "") => {
  if (cond) {
    pass++;
    console.log(`  ✅ ${name}${extra ? ` (${extra})` : ""}`);
  } else {
    fail++;
    console.log(`  ❌ ${name}${extra ? ` (${extra})` : ""}`);
  }
};
/** RPC chronométrée sur une session donnée. */
async function rpc(client, fn, args) {
  const t0 = Date.now();
  const { data, error } = await client.rpc(fn, args);
  return { data, error, ms: Date.now() - t0 };
}

const startIso = new Date().toISOString();
const admin = createClient(URL_, SR, { auth: { persistSession: false } });
const chS = createClient(URL_, ANON, { auth: { persistSession: false } });
const cuS = createClient(URL_, ANON, { auth: { persistSession: false } });
const anon = createClient(URL_, ANON, { auth: { persistSession: false } });

const tripIds = [];
let customerId = null;

try {
  // ── Connexions réelles ─────────────────────────────────────────────────
  let t0 = Date.now();
  const chLogin = await chS.auth.signInWithPassword({
    email: "0603044618@chauffeurs.coligo.local",
    password: "0603044618",
  });
  ok("login chauffeur (Said, Béjaïa)", !chLogin.error, `${Date.now() - t0}ms`);
  t0 = Date.now();
  const cuLogin = await cuS.auth.signInWithPassword({
    email: "qawaexpress@gmail.com",
    password: "qawaexpress@gmail.com",
  });
  ok("login client (qawaexpress)", !cuLogin.error, `${Date.now() - t0}ms`);
  if (chLogin.error || cuLogin.error) throw new Error("login KO");
  const { data: cust } = await admin
    .from("customers")
    .select("id")
    .eq("user_id", cuLogin.data.user.id)
    .maybeSingle();
  customerId = cust?.id ?? null;

  // ── 1. Publication (chauffeur) : Béjaïa → Alger, +3 h, 3 places, 900 DA ─
  const dep = new Date(Date.now() + 3 * 3600e3).toISOString();
  const pub = await rpc(chS, "carpool_publish_trip", {
    p_from_wilaya: "06",
    p_to_wilaya: "16",
    p_from_text: "Béjaïa — gare routière (test QA)",
    p_to_text: "Alger — Tafourah",
    p_departure_at: dep,
    p_seats: 3,
    p_price_da: 900,
    p_female_only: false,
  });
  ok("publier un départ 06→16", pub.data?.ok === true, `${pub.ms}ms`);
  if (pub.data?.trip_id) tripIds.push(pub.data.trip_id);
  const trip = pub.data?.trip_id;

  const badPub = await rpc(chS, "carpool_publish_trip", {
    p_from_wilaya: "16",
    p_to_wilaya: "16",
    p_from_text: "x",
    p_to_text: "y",
    p_departure_at: dep,
    p_seats: 2,
    p_price_da: 900,
    p_female_only: false,
  });
  ok("même wilaya refusée (bad_route)", badPub.data?.reason === "bad_route");

  // ── 2. Recherche (client) façon BlaBlaCar : 06 → 16, 3 places libres ───
  const search = await rpc(cuS, "carpool_search_trips", {
    p_from_wilaya: "06",
    p_to_wilaya: "16",
    p_date: null,
  });
  const found = (search.data ?? []).find((x) => x.id === trip);
  ok(
    "recherche filtrée 06→16 : départ visible, 3 places",
    !!found && found.seats_left === 3 && found.chauffeur_name?.length > 0,
    `${search.ms}ms`
  );

  // ── 3. Réservation 2 places ESPÈCES (client) → billet PIN ──────────────
  const bk = await rpc(cuS, "carpool_book_seats", {
    p_trip_id: trip,
    p_seats: 2,
    p_payment: "cash",
    p_operation_id: `qa-authed-${Date.now()}`,
  });
  ok(
    "réserver 2 places espèces → PIN",
    bk.data?.ok === true && /^\d{4}$/.test(bk.data?.pin ?? ""),
    `${bk.ms}ms`
  );
  const pin = bk.data?.pin;

  const mine = await rpc(cuS, "carpool_my_bookings", {});
  const myBk = (mine.data ?? []).find((b) => b.trip_id === trip);
  ok(
    "mes places : réservation visible avec PIN + chauffeur",
    myBk?.pin === pin && myBk?.status === "booked" && !!myBk?.chauffeur_name,
    `${mine.ms}ms`
  );

  // ── 4. Côté chauffeur : compteur, liste, embarquement PIN ──────────────
  const myTrips = await rpc(chS, "carpool_my_trips", {});
  const mt = (myTrips.data ?? []).find((x) => x.id === trip);
  ok(
    "mes départs : 2/3 places réservées, recette 1800",
    mt?.seats_booked === 2 && mt?.revenue_da === 1800,
    `${myTrips.ms}ms`
  );
  const tb = await rpc(chS, "carpool_trip_bookings", { p_trip_id: trip });
  const row = (tb.data ?? [])[0];
  ok(
    "réservations du départ : 1 ligne, sans PIN exposé",
    (tb.data ?? []).length === 1 && row?.seats === 2 && row?.pin === undefined,
    `${tb.ms}ms`
  );

  const badPin = await rpc(chS, "carpool_board_passenger", {
    p_trip_id: trip,
    p_pin: pin === "0000" ? "1111" : "0000",
  });
  ok("mauvais PIN refusé", badPin.data?.reason === "bad_pin");
  const board = await rpc(chS, "carpool_board_passenger", {
    p_trip_id: trip,
    p_pin: pin,
  });
  ok("embarquement par PIN", board.data?.ok === true, `${board.ms}ms`);

  // ── 5. Démarrer → clôturer → gains dans drive_my_finances ──────────────
  const st = await rpc(chS, "carpool_start_trip", { p_trip_id: trip });
  const done = await rpc(chS, "carpool_complete_trip", { p_trip_id: trip });
  ok(
    "démarrer puis clôturer (1800 DA espèces)",
    st.data?.ok === true &&
      done.data?.ok === true &&
      done.data?.cash_da === 1800,
    `${st.ms}+${done.ms}ms`
  );
  const fin = await rpc(chS, "drive_my_finances", {});
  const f = Array.isArray(fin.data) ? fin.data[0] : fin.data;
  ok(
    "gains : covoiturage dans drive_my_finances (jour + mois + départ compté)",
    Number(f?.carpool_today_net_da ?? 0) >= 1800 &&
      Number(f?.today_net_da ?? 0) >= 1800 &&
      Number(f?.carpool_month_trips ?? 0) >= 1,
    `${fin.ms}ms`
  );
  const mineDone = await rpc(cuS, "carpool_my_bookings", {});
  ok(
    "côté client : réservation passée « terminée »",
    (mineDone.data ?? []).find((b) => b.trip_id === trip)?.status ===
      "completed"
  );

  // ── 6. Annulations : réservation (remboursée) puis départ ──────────────
  const pub2 = await rpc(chS, "carpool_publish_trip", {
    p_from_wilaya: "06",
    p_to_wilaya: "19",
    p_from_text: "Béjaïa (test QA)",
    p_to_text: "Sétif",
    p_departure_at: new Date(Date.now() + 4 * 3600e3).toISOString(),
    p_seats: 2,
    p_price_da: 700,
    p_female_only: false,
  });
  if (pub2.data?.trip_id) tripIds.push(pub2.data.trip_id);
  // Coligo Pay si le solde le permet, sinon espèces (les deux rails valides).
  let bk2 = await rpc(cuS, "carpool_book_seats", {
    p_trip_id: pub2.data?.trip_id,
    p_seats: 1,
    p_payment: "coligo_pay",
    p_operation_id: `qa-authed2-${Date.now()}`,
  });
  let rail = "coligo_pay";
  if (bk2.data?.reason === "insufficient_balance") {
    rail = "cash";
    bk2 = await rpc(cuS, "carpool_book_seats", {
      p_trip_id: pub2.data?.trip_id,
      p_seats: 1,
      p_payment: "cash",
      p_operation_id: `qa-authed3-${Date.now()}`,
    });
  }
  ok(
    `réserver sur le 2ᵉ départ (${rail})`,
    bk2.data?.ok === true,
    `${bk2.ms}ms`
  );
  const cb = await rpc(cuS, "carpool_cancel_booking", {
    p_booking_id: bk2.data?.booking_id,
  });
  ok("annuler MA réservation (remboursée)", cb.data?.ok === true, `${cb.ms}ms`);
  const ct = await rpc(chS, "carpool_cancel_trip", {
    p_trip_id: pub2.data?.trip_id,
  });
  ok("annuler le départ (chauffeur)", ct.data?.ok === true, `${ct.ms}ms`);

  // ── 6bis. SEGMENTS (0445) : arrêt Bouira, montée en route ──────────────
  const pub3 = await rpc(chS, "carpool_publish_trip", {
    p_from_wilaya: "06",
    p_to_wilaya: "16",
    p_from_text: "Béjaïa — gare (QA seg)",
    p_to_text: "Alger — Tafourah",
    p_departure_at: new Date(Date.now() + 5 * 3600e3).toISOString(),
    p_seats: 3,
    p_price_da: 1000,
    p_female_only: false,
    p_stops: [{ wilaya: "10" }],
  });
  ok(
    "publier avec arrêt Bouira (06→10→16)",
    pub3.data?.ok === true,
    `${pub3.ms}ms`
  );
  if (pub3.data?.trip_id) tripIds.push(pub3.data.trip_id);
  const segSearch = await rpc(cuS, "carpool_search_trips", {
    p_from_wilaya: "10",
    p_to_wilaya: "16",
    p_date: null,
  });
  const segHit = (segSearch.data ?? []).find(
    (x) => x.id === pub3.data?.trip_id
  );
  ok(
    "recherche Bouira→Alger : segment matché, prix tronçon < complet",
    segHit?.from_seq === 1 &&
      segHit?.to_seq === 2 &&
      segHit?.seg_price_da < 1000 &&
      (segHit?.route_wilayas ?? []).join(",") === "06,10,16",
    `${segSearch.ms}ms`
  );
  const segBk = await rpc(cuS, "carpool_book_seats", {
    p_trip_id: pub3.data?.trip_id,
    p_seats: 1,
    p_payment: "cash",
    p_operation_id: `qa-seg-${Date.now()}`,
    p_from_seq: 1,
    p_to_seq: 2,
  });
  ok(
    "réserver le tronçon Bouira→Alger au prix du tronçon",
    segBk.data?.ok === true && segBk.data?.amount_da === segHit?.seg_price_da,
    `${segBk.ms}ms`
  );
  const myTrips2 = await rpc(chS, "carpool_trip_bookings", {
    p_trip_id: pub3.data?.trip_id,
  });
  const segRow = (myTrips2.data ?? [])[0];
  ok(
    "chauffeur voit le segment du passager (10 → 16)",
    segRow?.seg_from_wilaya === "10" && segRow?.seg_to_wilaya === "16"
  );
  // R8 (0446) : coordonnées échangées sur la réservation VIVANTE.
  ok(
    "téléphones : chauffeur voit le passager, passager voit le chauffeur",
    !!segRow?.customer_phone &&
      !!((await rpc(cuS, "carpool_my_bookings", {})).data ?? []).find(
        (b) => b.id === segBk.data?.booking_id
      )?.chauffeur_phone
  );

  // ── 7. Sécurité : ANON n'a accès à RIEN ────────────────────────────────
  const anonSearch = await rpc(anon, "carpool_search_trips", {
    p_from_wilaya: null,
    p_to_wilaya: null,
    p_date: null,
  });
  ok(
    "anon : carpool_search_trips REFUSÉE (REVOKE)",
    !!anonSearch.error,
    anonSearch.error?.code ?? ""
  );
  const anonPub = await rpc(anon, "carpool_publish_trip", {
    p_from_wilaya: "16",
    p_to_wilaya: "06",
    p_from_text: "x",
    p_to_text: "y",
    p_departure_at: dep,
    p_seats: 2,
    p_price_da: 900,
    p_female_only: false,
  });
  ok("anon : publication REFUSÉE (REVOKE)", !!anonPub.error);
  // Client ≠ chauffeur : les RPC chauffeur ne font rien pour un client.
  const cuAsCh = await rpc(cuS, "carpool_start_trip", { p_trip_id: trip });
  ok(
    "client sur RPC chauffeur → not_your_trip",
    cuAsCh.data?.reason === "not_your_trip"
  );
} finally {
  // ── NETTOYAGE service_role : zéro trace des données QA ─────────────────
  if (tripIds.length) {
    await admin.from("carpool_ledger").delete().in("trip_id", tripIds);
    await admin.from("carpool_bookings").delete().in("trip_id", tripIds);
    await admin.from("carpool_trips").delete().in("id", tripIds);
  }
  if (customerId) {
    // Entrées wallet du test (séquestre + remboursement, net zéro).
    await admin
      .from("customer_wallet_entries")
      .delete()
      .eq("customer_id", customerId)
      .ilike("note", "%covoiturage%")
      .gte("created_at", startIso);
  }
  const { count: leftTrips } = await admin
    .from("carpool_trips")
    .select("id", { count: "exact", head: true })
    .in(
      "id",
      tripIds.length ? tripIds : ["00000000-0000-0000-0000-000000000000"]
    );
  console.log(
    `  🧹 nettoyage : ${leftTrips === 0 ? "OK (zéro trace)" : `RESTE ${leftTrips} départ(s) !`}`
  );
}
console.log(`\n${pass}/${pass + fail} tests OK${fail ? " — ÉCHECS !" : ""}`);
process.exit(fail ? 1 : 0);
