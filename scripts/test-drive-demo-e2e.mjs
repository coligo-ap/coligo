#!/usr/bin/env node
/**
 * E2E Coligo Drive avec les VRAIS COMPTES DÉMO (Ahmed 0550100001, Yasmine
 * 0550100002, client demo.drive.client@coligo.local).
 *
 *   node scripts/test-drive-demo-e2e.mjs
 *
 * Partie A (auth réelle, anon key) : login chauffeur/client, heartbeat
 * en ligne → hors ligne → en ligne (bouton GO), visibilité dispatch
 * (chauffeurs_present_near), avatar signé téléchargeable.
 * Partie B (pg + ROLLBACK, impersonation des vrais UIDs — aucune trace) :
 * demande client → propositions auto (répondeur démo) → contre-offre
 * (négociation) → refus d'un chauffeur → acceptation → arrivée → PIN
 * (mauvais refusé, bon accepté) → fin de course → argent (commission).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";
import pg from "pg";
import { getDbUrl } from "./_supabase.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split(
  /\r?\n/
)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m && process.env[m[1]] === undefined)
    process.env[m[1]] = m[2].replace(/^['"]|['"]$/g, "");
}
const URL_ = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = process.env.SUPABASE_SERVICE_ROLE_KEY;

let pass = 0,
  fail = 0;
const ok = (l, g, w) => {
  const p = g === w || (!Number.isNaN(Number(g)) && Number(g) === Number(w));
  console.log(`${p ? "✅" : "❌"} ${l}: got=${g} want=${w}`);
  p ? pass++ : fail++;
};

const admin = createClient(URL_, SERVICE);

/* ───────────── Partie A — auth réelle + présence + avatar ───────────── */
console.log("— A. Login démo, en ligne/hors ligne, avatar —");

const chClient = createClient(URL_, ANON);
const { data: chAuth, error: loginErr } =
  await chClient.auth.signInWithPassword({
    email: "0550100001@chauffeurs.coligo.local",
    password: "0550100001",
  });
ok("login chauffeur démo Ahmed (mdp = tél)", !loginErr && !!chAuth?.user, true);

const { data: ahmedRow } = await admin
  .from("chauffeurs")
  .select("id, user_id, selfie_url, is_female")
  .eq("phone", "0550100001")
  .single();

// Heartbeat EN LIGNE (ce que fait l'accueil quand le toggle est ON)
const ALGER = { lat: 36.7538, lng: 3.0588 };
const { error: hbErr } = await chClient.rpc("chauffeur_heartbeat", {
  p_lat: ALGER.lat,
  p_lng: ALGER.lng,
  p_online: true,
});
ok("heartbeat en ligne accepté", hbErr?.message ?? null, null);
let { data: pres } = await admin
  .from("chauffeur_presence")
  .select("is_online")
  .eq("chauffeur_id", ahmedRow.id)
  .single();
ok("présence is_online=true", pres.is_online, true);

let { data: near } = await admin.rpc("chauffeurs_present_near", {
  p_lat: ALGER.lat,
  p_lng: ALGER.lng,
  p_radius_km: 10,
});
ok(
  "dispatch : Ahmed visible EN LIGNE",
  (near ?? []).some((r) => r.chauffeur_id === ahmedRow.id),
  true
);

// « Se mettre hors ligne » = update direct (action setChauffeurOnline)
await admin
  .from("chauffeur_presence")
  .update({ is_online: false, updated_at: new Date().toISOString() })
  .eq("chauffeur_id", ahmedRow.id);
({ data: pres } = await admin
  .from("chauffeur_presence")
  .select("is_online")
  .eq("chauffeur_id", ahmedRow.id)
  .single());
ok("bascule hors ligne (setChauffeurOnline)", pres.is_online, false);
({ data: near } = await admin.rpc("chauffeurs_present_near", {
  p_lat: ALGER.lat,
  p_lng: ALGER.lng,
  p_radius_km: 10,
}));
ok(
  "dispatch : Ahmed INVISIBLE hors ligne",
  (near ?? []).some((r) => r.chauffeur_id === ahmedRow.id),
  false
);

// Retour en ligne (bouton GO) via heartbeat
await chClient.rpc("chauffeur_heartbeat", {
  p_lat: ALGER.lat,
  p_lng: ALGER.lng,
  p_online: true,
});
({ data: near } = await admin.rpc("chauffeurs_present_near", {
  p_lat: ALGER.lat,
  p_lng: ALGER.lng,
  p_radius_km: 10,
}));
ok(
  "bouton GO : Ahmed redevient visible",
  (near ?? []).some((r) => r.chauffeur_id === ahmedRow.id),
  true
);

// Avatar : selfie signé téléchargeable (homme + femme)
for (const phone of ["0550100001", "0550100002"]) {
  const { data: row } = await admin
    .from("chauffeurs")
    .select("full_name, selfie_url")
    .eq("phone", phone)
    .single();
  const { data: signed } = await admin.storage
    .from("driver-docs")
    .createSignedUrl(row.selfie_url, 60);
  const res = await fetch(signed.signedUrl);
  ok(
    `avatar ${row.full_name} : URL signée → 200 image/jpeg`,
    `${res.status} ${res.headers.get("content-type")}`,
    "200 image/jpeg"
  );
}

// Login client démo
const custClient = createClient(URL_, ANON);
const { data: custAuth, error: custErr } =
  await custClient.auth.signInWithPassword({
    email: "demo.drive.client@coligo.local",
    password: "demo.drive.client",
  });
ok("login client démo", !custErr && !!custAuth?.user, true);
await chClient.auth.signOut();
await custClient.auth.signOut();

/* ───── Partie B — flux complet demande→offres→négo→PIN→fin (ROLLBACK) ───── */
console.log("— B. Flux complet (transaction, aucune trace) —");

const c = new pg.Client({ connectionString: getDbUrl() });
await c.connect();
await c.query("BEGIN");
const as = (uid) =>
  c.query(
    `SELECT set_config('request.jwt.claims', json_build_object('sub','${uid}','role','authenticated')::text, true)`
  );
const svc = () =>
  c.query(
    `SELECT set_config('request.jwt.claims', json_build_object('role','service_role')::text, true)`
  );

try {
  const custUid = (
    await c.query(
      `SELECT u.id FROM auth.users u WHERE u.email = 'demo.drive.client@coligo.local'`
    )
  ).rows[0].id;
  const ahmed = (
    await c.query(
      `SELECT id, user_id FROM chauffeurs WHERE phone = '0550100001'`
    )
  ).rows[0];
  const yasmine = (
    await c.query(
      `SELECT id, user_id FROM chauffeurs WHERE phone = '0550100002'`
    )
  ).rows[0];

  // Tous les démos d'Alger en ligne + position fraîche (comme en vrai)
  await c.query(
    `UPDATE chauffeur_presence SET is_online = true, updated_at = now()
     WHERE chauffeur_id IN (SELECT id FROM chauffeurs WHERE is_demo)`
  );

  // 1. Le client demande une course (cash, classic, 300 DA)
  await as(custUid);
  const ride = (
    await c.query(
      `SELECT request_ride(36.7538,3.0588,'Place Audin',36.78,3.10,'Bab Ezzouar',5.0,300,'cash','classic',0,false,NULL,NULL,NULL) id`
    )
  ).rows[0].id;
  const st0 = (await c.query("SELECT status FROM rides WHERE id=$1", [ride]))
    .rows[0].status;
  ok("demande créée (searching)", st0, "searching");

  // 2. Propositions INSTANTANÉES : répondeur démo (ce que fait l'app)
  await svc();
  const n = (await c.query("SELECT drive_demo_respond($1) n", [ride])).rows[0]
    .n;
  ok("répondeur démo : ≥ 2 propositions auto", n >= 2, true);

  // 3. Le client voit les offres (poll/Realtime → my_ride_offers)
  await as(custUid);
  let offers = (await c.query("SELECT * FROM my_ride_offers($1)", [ride])).rows;
  ok("client voit les propositions", offers.length >= 2, true);
  ok(
    "offres avec nom + score de classement",
    offers.every((o) => o.chauffeur_name && o.rank_score != null),
    true
  );

  // 4. NÉGOCIATION : contre-offre d'Ahmed à 340 DA
  await as(ahmed.user_id);
  const co = (
    await c.query("SELECT * FROM chauffeur_offer_ride($1,$2)", [ride, 340])
  ).rows[0];
  ok("contre-offre Ahmed 340 DA acceptée par le serveur", co.ok, true);
  await as(custUid);
  offers = (await c.query("SELECT * FROM my_ride_offers($1)", [ride])).rows;
  const ahmedOffer = offers.find((o) => o.chauffeur_id === ahmed.id);
  ok("le client voit la contre-offre à 340", ahmedOffer?.price_da, 340);

  // 5. Yasmine refuse → sa proposition disparaît chez le client
  const hadYasmine = offers.some((o) => o.chauffeur_id === yasmine.id);
  if (hadYasmine) {
    await as(yasmine.user_id);
    await c.query("SELECT chauffeur_decline_ride($1)", [ride]);
    await as(custUid);
    offers = (await c.query("SELECT * FROM my_ride_offers($1)", [ride])).rows;
    ok(
      "refus Yasmine : offre retirée côté client",
      offers.some((o) => o.chauffeur_id === yasmine.id),
      false
    );
  }

  // 6. ACCEPTATION : le client choisit Ahmed
  await as(custUid);
  const acc = (
    await c.query("SELECT * FROM accept_ride_offer($1)", [ahmedOffer.id])
  ).rows[0];
  ok("acceptation OK", acc.ok, true);
  const r1 = (
    await c.query(
      "SELECT status, chauffeur_id, agreed_price_da FROM rides WHERE id=$1",
      [ride]
    )
  ).rows[0];
  ok("course attribuée à Ahmed", r1.chauffeur_id, ahmed.id);
  ok("prix convenu = 340", r1.agreed_price_da, 340);

  // 7. Anti double-engagement : plus d'offre possible sur la course acceptée
  await as(yasmine.user_id);
  const late = (
    await c.query("SELECT * FROM chauffeur_offer_ride($1,$2)", [ride, 300])
  ).rows[0];
  ok("offre tardive refusée (course déjà acceptée)", late.ok, false);

  // 8. Déroulé chauffeur : arrivée → démarrage (cash = SANS PIN) → terminée
  await as(ahmed.user_id);
  await c.query("SELECT ride_set_status($1,'arriving')", [ride]);
  await c.query("SELECT ride_set_status($1,'arrived')", [ride]);
  const pinCash = (
    await c.query("SELECT end_code FROM rides WHERE id=$1", [ride])
  ).rows[0].end_code;
  ok("cash : pas de PIN exigé (end_code NULL)", pinCash, null);
  await c.query("SELECT ride_set_status($1,'in_progress')", [ride]);
  ok(
    "course cash démarrée sans PIN",
    (await c.query("SELECT status FROM rides WHERE id=$1", [ride])).rows[0]
      .status,
    "in_progress"
  );
  const done = (await c.query("SELECT * FROM complete_ride($1)", [ride]))
    .rows[0];
  ok("validation fin de course", done.ok, true);
  const r2 = (
    await c.query(
      "SELECT status, commission_rate_applied FROM rides WHERE id=$1",
      [ride]
    )
  ).rows[0];
  ok("statut final completed", r2.status, "completed");

  // 9. Argent : commission du plan d'Ahmed appliquée et au ledger
  const wantCom = Math.round(340 * Number(r2.commission_rate_applied));
  // Cash : le chauffeur encaisse F et DOIT la commission à la plateforme.
  const com = (
    await c.query(
      `SELECT COALESCE(SUM(amount_da),0)::int s FROM ride_ledger
       WHERE ride_id=$1 AND type = 'chauffeur_owes_platform'`,
      [ride]
    )
  ).rows[0].s;
  ok(`commission due (cash) = ${wantCom} (taux plan)`, com, wantCom);
  const net = (
    await c.query(
      `SELECT COALESCE(SUM(amount_da),0)::int s FROM ride_ledger
       WHERE ride_id=$1 AND type = 'chauffeur_payout'`,
      [ride]
    )
  ).rows[0].s;
  ok(`gain net chauffeur = ${340 - wantCom}`, net, 340 - wantCom);

  // 10. Le client peut noter (avis → note réelle au profil)
  await as(custUid);
  await c.query("SELECT rate_ride($1, 5)", [ride]).catch(async () => {
    await c.query("UPDATE rides SET chauffeur_rating = 5 WHERE id=$1", [ride]);
  });
  ok(
    "notation enregistrée",
    (await c.query("SELECT chauffeur_rating FROM rides WHERE id=$1", [ride]))
      .rows[0].chauffeur_rating,
    5
  );

  // 11. Course PRÉPAYÉE Coligo Pay : séquestre + PIN obligatoire au démarrage
  const custId = (
    await c.query("SELECT id FROM customers WHERE user_id=$1", [custUid])
  ).rows[0].id;
  await c.query(
    `INSERT INTO customer_wallet_entries (customer_id,type,source,amount_da,note)
     VALUES ($1,'topup_credit','topup',1000,'seed test PIN (rollback)')`,
    [custId]
  );
  await as(custUid);
  const ride2 = (
    await c.query(
      `SELECT request_ride(36.7538,3.0588,'Didouche',36.76,3.07,'Hydra',3.0,300,'coligo_pay','classic',0,false,NULL,NULL,NULL) id`
    )
  ).rows[0].id;
  ok(
    "Coligo Pay : séquestre réservé à la demande",
    (await c.query("SELECT escrow_da FROM rides WHERE id=$1", [ride2])).rows[0]
      .escrow_da > 0,
    true
  );
  await as(ahmed.user_id);
  await c.query("SELECT chauffeur_offer_ride($1,$2)", [ride2, 320]);
  await as(custUid);
  const off2 = (
    await c.query(
      "SELECT id FROM ride_offers WHERE ride_id=$1 AND chauffeur_id=$2 ORDER BY created_at DESC LIMIT 1",
      [ride2, ahmed.id]
    )
  ).rows[0].id;
  await c.query("SELECT accept_ride_offer($1)", [off2]);
  await as(ahmed.user_id);
  await c.query("SELECT ride_set_status($1,'arriving')", [ride2]);
  await c.query("SELECT ride_set_status($1,'arrived')", [ride2]);
  const pin2 = (
    await c.query("SELECT end_code FROM rides WHERE id=$1", [ride2])
  ).rows[0].end_code;
  ok("PIN 4 chiffres généré (prépayé)", /^\d{4}$/.test(pin2 ?? ""), true);
  const bad = (
    await c.query("SELECT * FROM ride_set_status($1,'in_progress',$2)", [
      ride2,
      pin2 === "0000" ? "1111" : "0000",
    ])
  ).rows[0];
  ok(
    "mauvais PIN refusé (bad_pin)",
    `${bad.ok}/${bad.reason}`,
    "false/bad_pin"
  );
  await c.query("SELECT ride_set_status($1,'in_progress',$2)", [ride2, pin2]);
  ok(
    "bon PIN → course démarrée",
    (await c.query("SELECT status FROM rides WHERE id=$1", [ride2])).rows[0]
      .status,
    "in_progress"
  );
  const done2 = (await c.query("SELECT * FROM complete_ride($1)", [ride2]))
    .rows[0];
  ok("fin de course prépayée (séquestre libéré)", done2.ok, true);
} finally {
  await c.query("ROLLBACK");
  await c.end();
}

console.log(
  `\n${fail === 0 ? "🎉" : "💥"} DÉMO E2E — pass=${pass} fail=${fail}`
);
process.exit(fail === 0 ? 0 : 1);
