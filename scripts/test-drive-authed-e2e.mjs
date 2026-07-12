// =============================================================================
// E2E Drive EN CONDITIONS RÉELLES — deux sessions AUTHENTIFIÉES (supabase-js,
// clé anon + mot de passe), exactement comme l'app : RLS, RPC, Realtime.
// =============================================================================
// Parcours couvert : demande client → offre chauffeur (reçue en TEMPS RÉEL) →
// acceptation → arriving/arrivé/à bord → terminée → notation des 2 côtés →
// POURBOIRE Coligo Pay (mig 0363) → chat (envoi 2 côtés, accusés Reçu/Lu,
// Realtime) → notifications (Realtime + non-lus + marquage lu).
//
// État : crée UNE course terminée (même nature que db:seed) ; portefeuille
// client net 0 (crédit test +100 → pourboire −100) ; chauffeur remis hors
// ligne ; notification de test supprimée. Comptes de test (mdp = identifiant,
// ne jamais changer) : client qawaexpress@gmail.com · chauffeur 0603044618.
// =============================================================================

import { readFileSync } from "node:fs";
import { createClient } from "@supabase/supabase-js";

const env = Object.fromEntries(
  readFileSync(new URL("../.env.local", import.meta.url), "utf8")
    .split(/\r?\n/)
    .filter((l) => l.includes("=") && !l.trim().startsWith("#"))
    .map((l) => [
      l.slice(0, l.indexOf("=")).trim(),
      l.slice(l.indexOf("=") + 1).trim(),
    ])
);
const URL_ = env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE = env.SUPABASE_SERVICE_ROLE_KEY;
if (!URL_ || !ANON || !SERVICE) {
  console.error("Variables Supabase manquantes dans .env.local");
  process.exit(1);
}

const PICKUP = { lat: 36.75, lng: 3.06, text: "Alger Centre (test E2E)" };
const DEST = { lat: 36.78, lng: 3.1, text: "Hydra (test E2E)" };

let pass = 0,
  fail = 0;
const ok = (label, got, want = true) => {
  const p = got === want;
  console.log(
    `${p ? "✅" : "❌"} ${label}${p ? "" : ` (got=${got} want=${want})`}`
  );
  p ? pass++ : fail++;
};
const step = (t) => console.log(`\n=== ${t} ===`);

/** Attend qu'un événement Realtime arrive (sinon échec après timeout). */
const waitFor = (label, ms = 12_000) => {
  let resolve;
  const p = new Promise((r) => (resolve = r));
  const timer = setTimeout(() => resolve(false), ms);
  return {
    fire: () => {
      clearTimeout(timer);
      resolve(true);
    },
    assert: async () => ok(label, await p),
  };
};

const svc = createClient(URL_, SERVICE, { auth: { persistSession: false } });
const cust = createClient(URL_, ANON, { auth: { persistSession: false } });
const chau = createClient(URL_, ANON, { auth: { persistSession: false } });

step("0) Connexion des deux sessions (mot de passe réel)");
{
  const a = await cust.auth.signInWithPassword({
    email: "qawaexpress@gmail.com",
    password: "qawaexpress@gmail.com",
  });
  ok("client connecté (qawaexpress@gmail.com)", !a.error);
  const b = await chau.auth.signInWithPassword({
    email: "0603044618@chauffeurs.coligo.local",
    password: "0603044618",
  });
  ok("chauffeur connecté (Yacine driver)", !b.error);
  if (a.error || b.error) {
    console.error(a.error?.message ?? b.error?.message);
    process.exit(1);
  }
}
const custUserId = (await cust.auth.getUser()).data.user.id;

// ─── Pré-état : aucune course active des deux côtés ───
step("1) Pré-état : purge des courses actives résiduelles");
{
  const { data: c1 } = await svc
    .from("customers")
    .select("id")
    .eq("user_id", custUserId)
    .single();
  const { data: actives } = await svc
    .from("rides")
    .select("id, status")
    .eq("customer_id", c1.id)
    .in("status", [
      "searching",
      "accepted",
      "arriving",
      "arrived",
      "in_progress",
    ]);
  for (const r of actives ?? []) {
    await cust.rpc("cancel_ride", {
      p_ride_id: r.id,
      p_reason: "purge test E2E",
    });
  }
  ok("client sans course active", true);
}

// ─── Chauffeur en ligne au point de départ ───
step("2) Chauffeur EN LIGNE près du départ (heartbeat réel)");
{
  const { error } = await chau.rpc("chauffeur_heartbeat", {
    p_lat: PICKUP.lat,
    p_lng: PICKUP.lng,
    p_online: true,
  });
  ok("heartbeat accepté", !error);
}

// ─── Demande de course (client) ───
step("3) Le client demande une course (cash)");
let rideId;
{
  const { data, error } = await cust.rpc("request_ride", {
    p_pickup_lat: PICKUP.lat,
    p_pickup_lng: PICKUP.lng,
    p_pickup_text: PICKUP.text,
    p_dest_lat: DEST.lat,
    p_dest_lng: DEST.lng,
    p_dest_text: DEST.text,
    p_distance_km: 5.0,
    p_proposed_price: 0,
    p_payment_method: "cash",
    p_gamme: "classic",
    p_boost_da: 0,
    p_female_only: false,
    p_proxy_name: null,
    p_proxy_phone: null,
    p_operation_id: `e2e-${Date.now()}`,
    p_pickup_wilaya: "16",
    p_pickup_commune: null,
    p_dest_wilaya: "16",
    p_dest_commune: null,
  });
  if (error) {
    console.error("request_ride:", error.message);
    process.exit(1);
  }
  rideId = data;
  ok("course créée (searching)", !!rideId);
}

// ─── Realtime CLIENT : offres + statut de course ───
const evOffer = waitFor(
  "REALTIME client : offre chauffeur reçue instantanément"
);
const evStatus = waitFor(
  "REALTIME client : changement de statut de course reçu"
);
const chOffers = cust
  .channel(`e2e-offers-${rideId}`)
  .on(
    "postgres_changes",
    {
      event: "*",
      schema: "public",
      table: "ride_offers",
      filter: `ride_id=eq.${rideId}`,
    },
    () => evOffer.fire()
  )
  .subscribe();
const chRide = cust
  .channel(`e2e-ride-${rideId}`)
  .on(
    "postgres_changes",
    {
      event: "UPDATE",
      schema: "public",
      table: "rides",
      filter: `id=eq.${rideId}`,
    },
    () => evStatus.fire()
  )
  .subscribe();
await new Promise((r) => setTimeout(r, 1500)); // abonnements établis

// ─── Offre chauffeur ───
step("4) Le chauffeur voit la demande et fait une offre");
let offerPrice;
{
  const { data: r } = await chau
    .from("rides")
    .select("proposed_price_da")
    .eq("id", rideId)
    .maybeSingle();
  offerPrice = (r?.proposed_price_da ?? 300) + 50;
  const { data, error } = await chau.rpc("chauffeur_offer_ride", {
    p_ride_id: rideId,
    p_price: offerPrice,
  });
  const row = Array.isArray(data) ? data[0] : data;
  ok("offre envoyée", !error && row?.ok === true);
}
await evOffer.assert();

// ─── Acceptation client ───
step("5) Le client accepte l'offre");
{
  const { data: offers } = await cust
    .from("ride_offers")
    .select("id, price_da")
    .eq("ride_id", rideId)
    .eq("status", "offered");
  ok("le client VOIT l'offre (RLS)", (offers ?? []).length, 1);
  const { data, error } = await cust.rpc("accept_ride_offer", {
    p_offer_id: offers[0].id,
    p_operation_id: `e2e-acc-${Date.now()}`,
  });
  const row = Array.isArray(data) ? data[0] : data;
  ok("offre acceptée", !error && row?.ok === true);
  const { data: r } = await cust
    .from("rides")
    .select("status, agreed_price_da")
    .eq("id", rideId)
    .single();
  ok("statut = accepted", r.status, "accepted");
  ok("prix convenu = offre", r.agreed_price_da, offerPrice);
}

// ─── Cycle chauffeur ───
step("6) Cycle chauffeur : en route → arrivé → client à bord → terminée");
{
  for (const status of ["arriving", "arrived", "in_progress"]) {
    const { data, error } = await chau.rpc("ride_set_status", {
      p_ride_id: rideId,
      p_status: status,
      p_pin: null,
    });
    const row = Array.isArray(data) ? data[0] : data;
    ok(`transition ${status}`, !error && row?.ok === true);
  }
  const { data, error } = await chau.rpc("complete_ride", {
    p_ride_id: rideId,
  });
  const row = Array.isArray(data) ? data[0] : data;
  ok("course TERMINÉE", !error && row?.ok === true);
}
await evStatus.assert();

// ─── Notations croisées ───
step("7) Notations : client → chauffeur et chauffeur → client");
{
  const a = await cust.rpc("rate_ride", { p_ride_id: rideId, p_rating: 5 });
  ok("client note 5 étoiles", !a.error);
  const b = await chau.rpc("rate_ride", { p_ride_id: rideId, p_rating: 4 });
  ok("chauffeur note 4 étoiles", !b.error);
  const { data: r } = await svc
    .from("rides")
    .select("chauffeur_rating, client_rating")
    .eq("id", rideId)
    .single();
  ok("note chauffeur enregistrée", r.chauffeur_rating, 5);
  ok("note client enregistrée", r.client_rating, 4);
}

// ─── Pourboire (mig 0363) ───
step("8) Pourboire Coligo Pay : +100 DA (session client réelle)");
{
  const { data: c1 } = await svc
    .from("customers")
    .select("id")
    .eq("user_id", custUserId)
    .single();
  await svc.from("customer_wallet_entries").insert({
    customer_id: c1.id,
    order_id: null,
    type: "topup_credit",
    source: "topup",
    amount_da: 100,
    note: "Crédit test E2E pourboire (net 0 après tip)",
  });
  const { data, error } = await cust.rpc("drive_tip_ride", {
    p_ride_id: rideId,
    p_amount_da: 100,
  });
  const row = Array.isArray(data) ? data[0] : data;
  ok("pourboire accepté", !error && row?.ok === true);
  const again = await cust.rpc("drive_tip_ride", {
    p_ride_id: rideId,
    p_amount_da: 100,
  });
  const row2 = Array.isArray(again.data) ? again.data[0] : again.data;
  ok("2e pourboire refusé (idempotent)", row2?.reason, "already_tipped");
  // Le CHAUFFEUR voit le pourboire sur SA course (RLS réelle).
  const { data: r } = await chau
    .from("rides")
    .select("tip_da")
    .eq("id", rideId)
    .single();
  ok("chauffeur voit tip_da = 100 (RLS)", r?.tip_da, 100);
  const { data: led } = await svc
    .from("ride_ledger")
    .select("amount_da")
    .eq("ride_id", rideId)
    .eq("type", "chauffeur_tip")
    .single();
  ok("ledger chauffeur_tip = 100", led?.amount_da, 100);
}

// ─── Chat + accusés ───
step("9) Chat de course : envoi 2 côtés, Realtime, accusés Reçu/Lu");
{
  const evMsg = waitFor(
    "REALTIME client : message du chauffeur reçu instantanément"
  );
  const chMsg = cust
    .channel(`e2e-msg-${rideId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "ride_messages",
        filter: `ride_id=eq.${rideId}`,
      },
      () => evMsg.fire()
    )
    .subscribe();
  await new Promise((r) => setTimeout(r, 1200));

  const m1 = await cust
    .from("ride_messages")
    .insert({
      ride_id: rideId,
      sender: "customer",
      body: "Merci pour la course !",
    });
  ok("client envoie un message", !m1.error);
  const m2 = await chau
    .from("ride_messages")
    .insert({
      ride_id: rideId,
      sender: "chauffeur",
      body: "Avec plaisir, bonne journée !",
    });
  ok("chauffeur répond", !m2.error);
  await evMsg.assert();

  // Le client OUVRE le chat → messages du chauffeur marqués LUS.
  await cust.rpc("mark_ride_messages_read", {
    p_ride_id: rideId,
    p_read: true,
  });
  const { data: msgs } = await chau
    .from("ride_messages")
    .select("sender, read_at, delivered_at")
    .eq("ride_id", rideId)
    .order("created_at");
  const mineRead = (msgs ?? []).find((m) => m.sender === "chauffeur");
  ok("le chauffeur voit son message « Lu »", !!mineRead?.read_at);
  await cust.removeChannel(chMsg);
}

// ─── Notifications ───
step("10) Notifications : Realtime + non-lus + marquage lu (session client)");
{
  const evNotif = waitFor(
    "REALTIME client : notification reçue instantanément"
  );
  const chNotif = cust
    .channel(`e2e-notif-${custUserId}`)
    .on(
      "postgres_changes",
      {
        event: "INSERT",
        schema: "public",
        table: "user_notifications",
        filter: `user_id=eq.${custUserId}`,
      },
      () => evNotif.fire()
    )
    .subscribe();
  await new Promise((r) => setTimeout(r, 1200));

  await svc.from("user_notifications").insert({
    user_id: custUserId,
    audience: "customer",
    kind: "ride_completed",
    title: "E2E-TEST notification",
    body: "Course terminée — notez votre chauffeur.",
    route: "/drive",
  });
  await evNotif.assert();

  const { data: notifs } = await cust
    .from("user_notifications")
    .select("id, read_at")
    .eq("audience", "customer")
    .is("read_at", null);
  ok("compteur non-lus ≥ 1", (notifs ?? []).length >= 1);
  await cust.rpc("mark_user_notifications_read", {
    p_audience: "customer",
    p_ids: null,
  });
  const { data: after } = await cust
    .from("user_notifications")
    .select("id")
    .eq("audience", "customer")
    .is("read_at", null);
  ok("badge à zéro après marquage lu", (after ?? []).length, 0);
  await cust.removeChannel(chNotif);
  await svc
    .from("user_notifications")
    .delete()
    .eq("title", "E2E-TEST notification");
}

// ─── Nettoyage ───
step("11) Nettoyage : chauffeur hors ligne, canaux fermés");
await chau.rpc("chauffeur_heartbeat", {
  p_lat: PICKUP.lat,
  p_lng: PICKUP.lng,
  p_online: false,
});
await cust.removeChannel(chOffers);
await cust.removeChannel(chRide);
await cust.auth.signOut();
await chau.auth.signOut();

console.log(`\nRésultat : ${pass} pass, ${fail} fail`);
if (fail > 0) process.exit(1);
console.log(
  "✅ PARCOURS DRIVE COMPLET VALIDÉ EN SESSIONS AUTHENTIFIÉES RÉELLES"
);
process.exit(0);
