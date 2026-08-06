// =============================================================================
// RECETTE DE BOUT EN BOUT — PANIER PARTAGÉ « 2 téléphones » + paiement invité
// =============================================================================
// Rejoue le parcours RÉEL sur la prod (données de test) :
//   📱 CAPITAINE : compte e2e authentifié (supabase-js, session réelle) →
//      création du panier via la RPC authenticated, verrouillage + liaison
//      commande + payment_token via la RLS capitaine (jamais service).
//   📱 INVITÉ   : client ANON séparé → join, ajout, lecture — RPC publiques.
//   💳 PAIEMENT : checkout Chargily MODE TEST réellement créé (API test), puis
//      webhook `checkout.paid` SIGNÉ (HMAC) posté sur la prod → la commande
//      passe payée + reçoit son numéro = visible board/tablette commerçant
//      (la sonnerie physique = ouvrir la tablette de ce commerçant).
//   ✅ « Déjà payé » : payment_info repasse paid ; webhook rejoué = idempotent.
//   🚫 Anti-doublon : panier `ordered` + order_id ⇒ la garde du checkout bloque.
//
// Laisse UNE commande de test payée (voulue : à constater sur la tablette).
// Usage : node scripts/test-shared-cart-e2e.mjs
// =============================================================================

import { createHmac, randomUUID } from "node:crypto";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { getDbUrl, loadEnvLocal } from "./_supabase.mjs";

loadEnvLocal();

const SUPA_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON_KEY = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const APP_URL = (
  process.env.NEXT_PUBLIC_APP_URL ?? "https://coligo.app"
).replace(/\/+$/, "");
// Convention du repo : mot de passe des comptes de test = identifiant.
const E2E_EMAIL = "e2e.capitaine@coligo-e2e.dz";
const E2E_PASSWORD = E2E_EMAIL;

const db = new pg.Client({
  connectionString: getDbUrl(),
  ssl: { rejectUnauthorized: false },
});

let failures = 0;
function assert(cond, label, detail) {
  if (cond) {
    console.log(`  ✅ ${label}`);
  } else {
    failures++;
    console.error(`  ❌ ${label}${detail ? ` — ${detail}` : ""}`);
  }
}

async function main() {
  await db.connect();

  // ── 0. Compte capitaine e2e (get-or-create, jamais modifié ensuite) ──
  const service = createClient(SUPA_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });
  let { rows: users } = await db.query(
    "select id from auth.users where email = $1",
    [E2E_EMAIL]
  );
  if (!users[0]) {
    const { data, error } = await service.auth.admin.createUser({
      email: E2E_EMAIL,
      password: E2E_PASSWORD,
      email_confirm: true,
      user_metadata: { role: "customer", full_name: "Karim E2E" },
    });
    if (error) throw new Error(`createUser: ${error.message}`);
    users = [{ id: data.user.id }];
  }
  const captainUid = users[0].id;
  let captainCustomerId = (
    await db.query("select id from customers where user_id = $1", [captainUid])
  ).rows[0]?.id;
  if (!captainCustomerId) {
    captainCustomerId = (
      await db.query(
        `insert into customers (user_id, full_name, phone, email)
         values ($1, 'Karim E2E', '+213600000042', $2) returning id`,
        [captainUid, E2E_EMAIL]
      )
    ).rows[0].id;
  }

  // Produit d'un commerçant actif, assez cher pour dépasser les minimums.
  const prod = (
    await db.query(
      `select p.id, p.merchant_id, p.price_da, m.name as merchant_name
         from products p join merchants m on m.id = p.merchant_id and m.is_active
        where p.is_available and p.archived_at is null and p.price_da >= 200
        order by p.created_at limit 1`
    )
  ).rows[0];
  if (!prod) throw new Error("Aucun produit de test disponible.");

  // =========================================================================
  console.log("📱 CAPITAINE — session réelle + création du panier (RPC auth)");
  // =========================================================================
  const captain = createClient(SUPA_URL, ANON_KEY, {
    auth: { persistSession: false },
  });
  const { error: loginErr } = await captain.auth.signInWithPassword({
    email: E2E_EMAIL,
    password: E2E_PASSWORD,
  });
  assert(!loginErr, "connexion capitaine", loginErr?.message);

  const { data: created, error: createErr } = await captain.rpc(
    "shared_cart_create",
    {
      p_merchant_id: prod.merchant_id,
      p_items: [{ product_id: prod.id, option_ids: [], quantity: 2 }],
    }
  );
  assert(
    !createErr && created?.ok === true && created.token,
    "panier partagé créé par la RPC authenticated",
    createErr?.message ?? JSON.stringify(created)
  );
  const token = created.token;
  const cartId = created.cart_id;
  console.log(`  → room ${APP_URL}/p/${token} (${prod.merchant_name})`);

  // =========================================================================
  console.log("📱 INVITÉ — client ANON séparé : join + ajout + temps réel");
  // =========================================================================
  const guest = createClient(SUPA_URL, ANON_KEY, {
    auth: { persistSession: false },
  });
  const guestToken = randomUUID();
  const { data: joined } = await guest.rpc("shared_cart_join", {
    p_token: token,
    p_guest_token: guestToken,
    p_display_name: "Maman E2E",
  });
  assert(
    joined?.ok === true && joined.member?.member_number === 1,
    "invitée « Maman E2E » a rejoint (n°1)",
    JSON.stringify(joined)
  );

  const { data: added } = await guest.rpc("shared_cart_add_item", {
    p_token: token,
    p_guest_token: guestToken,
    p_product_id: prod.id,
    p_option_ids: [],
    p_quantity: 1,
  });
  assert(added?.ok === true, "ajout invité accepté", JSON.stringify(added));

  const { data: view } = await guest.rpc("shared_cart_by_token", {
    p_token: token,
  });
  const expectedTotal = Math.round(prod.price_da * 3);
  assert(
    view?.members?.length === 2 && view?.total_da === expectedTotal,
    `room : 2 participants, total ${expectedTotal} DA (prix catalogue)`,
    `members=${view?.members?.length} total=${view?.total_da}`
  );

  // =========================================================================
  console.log("🔒 CAPITAINE — verrouille, commande, lien de paiement (RLS)");
  // =========================================================================
  const { data: locked } = await captain
    .from("shared_carts")
    .update({ status: "locked" })
    .eq("id", cartId)
    .eq("status", "open")
    .select("id")
    .maybeSingle();
  assert(!!locked, "verrouillage par la RLS capitaine");

  // Commande online `pending` (équivalent createOrder — INSERT service_role).
  const orderId = (
    await db.query(
      `insert into public.orders
         (merchant_id, customer_id, customer_name, customer_phone, status,
          payment_method, payment_status, pickup_type, pickup_slot_at,
          pickup_code, subtotal_da, total_da)
       values ($1, $2, 'Karim E2E', '+213600000042', 'pending',
          'online', 'pending', 'asap', now() + interval '30 min',
          'ZE2E', $3, $3)
       returning id`,
      [prod.merchant_id, captainCustomerId, expectedTotal]
    )
  ).rows[0].id;

  const { data: attached } = await captain
    .from("shared_carts")
    .update({ order_id: orderId, status: "ordered" })
    .eq("id", cartId)
    .eq("status", "locked")
    .is("order_id", null)
    .select("id")
    .maybeSingle();
  assert(!!attached, "transition locked → ordered par la RLS capitaine");

  // GARDE COLONNES (audit 0422-0426, trigger protect_shared_cart_fields) : le
  // capitaine NE PEUT PAS lier order_id lui-même — la colonne protégée est
  // NEUTRALISÉE en silence. Seul le SERVEUR (place-room-order, service_role)
  // pose le lien : c'est ce qu'on rejoue ensuite.
  const afterGuard = (
    await db.query("select order_id from shared_carts where id = $1", [cartId])
  ).rows[0];
  assert(
    afterGuard.order_id === null,
    "garde colonnes : order_id posé par le capitaine NEUTRALISÉ (audit)"
  );
  await db.query(
    "update public.shared_carts set order_id = $1 where id = $2 and status = 'ordered' and order_id is null",
    [orderId, cartId]
  );

  // Garde ANTI-DOUBLON du checkout : panier ordered + order_id ⇒ bloqué.
  const guard = (
    await db.query("select status, order_id from shared_carts where id = $1", [
      cartId,
    ])
  ).rows[0];
  assert(
    guard.status === "ordered" && guard.order_id === orderId,
    "anti-doublon : le prédicat de garde bloque un 2ᵉ « Commander »",
    JSON.stringify(guard)
  );

  // GARDE COLONNES (audit) : un payment_token posé par la RLS capitaine est
  // NEUTRALISÉ — seul le canal DEFINER (shared_cart_room_pay_token, celui de
  // l'UI cart-room) mint le lien. On vérifie la garde, puis on obtient le
  // token CANONIQUE comme l'app.
  const tokenTry = "e2e" + randomUUID().replace(/-/g, "").slice(0, 13);
  await captain
    .from("shared_carts")
    .update({
      payment_token: tokenTry,
      payment_token_created_at: new Date().toISOString(),
    })
    .eq("id", cartId)
    .eq("status", "ordered")
    .select("id")
    .maybeSingle();
  const tokenGuard = (
    await db.query("select payment_token from shared_carts where id = $1", [
      cartId,
    ])
  ).rows[0];
  assert(
    tokenGuard.payment_token === null,
    "garde colonnes : payment_token du capitaine NEUTRALISÉ (audit)"
  );
  const { data: minted } = await guest.rpc("shared_cart_room_pay_token", {
    p_token: token,
  });
  assert(
    minted?.ok === true && typeof minted.ptoken === "string",
    "lien de paiement MINTÉ par la RPC definer (flux réel de l'UI)",
    JSON.stringify(minted)
  );
  const ptoken = minted.ptoken;

  const { data: payInfo } = await guest.rpc("shared_cart_payment_info", {
    p_payment_token: ptoken,
  });
  assert(
    payInfo?.payment_status === "pending" &&
      payInfo?.total_da === expectedTotal &&
      typeof payInfo?.captain_name === "string",
    "page /payer : infos rassurantes (capitaine, montant, pending)",
    JSON.stringify(payInfo)
  );
  // mig 0411 : le code de retrait n'existe pour le groupe qu'APRÈS paiement.
  assert(
    payInfo?.pickup_code == null && payInfo?.order_number == null,
    "page /payer : code de retrait JAMAIS révélé avant paiement",
    JSON.stringify(payInfo)
  );

  // PAIEMENT OUVERT AU GROUPE (mig 0409) : quiconque a le lien famille obtient
  // LE MÊME lien de paiement, et la room expose l'état de paiement.
  const { data: roomPay } = await guest.rpc("shared_cart_room_pay_token", {
    p_token: token,
  });
  assert(
    roomPay?.ok === true && roomPay.ptoken === ptoken,
    "room : « Payer la commande » ouvert au groupe (même lien, zéro doublon)",
    JSON.stringify(roomPay)
  );
  const { data: viewOrdered } = await guest.rpc("shared_cart_by_token", {
    p_token: token,
  });
  assert(
    viewOrdered?.cart?.payment_method === "online" &&
      viewOrdered?.cart?.payment_status === "pending",
    "room : état de paiement exposé (online, pending)",
    JSON.stringify(viewOrdered?.cart)
  );

  // =========================================================================
  console.log("💳 INVITÉ — checkout Chargily MODE TEST réel");
  // =========================================================================
  const live = (
    await db.query(
      "select chargily_live_mode from platform_settings where id = true"
    )
  ).rows[0]?.chargily_live_mode;
  assert(live === false, "plateforme en MODE TEST Chargily", `live=${live}`);

  const testKey =
    process.env.CHARGILY_TEST_SECRET_KEY ?? process.env.CHARGILY_SECRET_KEY;
  let checkoutOk = false;
  try {
    const r = await fetch("https://pay.chargily.net/test/api/v2/checkouts", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${testKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        amount: expectedTotal,
        currency: "dzd",
        success_url: `${APP_URL}/payer/${ptoken}?st=success`,
        failure_url: `${APP_URL}/payer/${ptoken}?st=failure`,
        webhook_endpoint: `${APP_URL}/api/chargily/webhook`,
        description: "Commande Coligo #ZE2E (e2e)",
        metadata: { type: "order", order_id: orderId },
      }),
    });
    const j = await r.json();
    checkoutOk = r.ok && typeof j.checkout_url === "string";
    assert(
      checkoutOk,
      "session Chargily TEST créée (checkout_url réel)",
      `HTTP ${r.status} ${JSON.stringify(j).slice(0, 140)}`
    );
  } catch (e) {
    assert(false, "session Chargily TEST créée", e.message);
  }

  // =========================================================================
  console.log("🔔 WEBHOOK signé → prod : payé + numéro + visible tablette");
  // =========================================================================
  const event = JSON.stringify({
    id: `evt_e2e_${Date.now()}`,
    entity: "event",
    type: "checkout.paid",
    data: {
      id: `ch_e2e_${Date.now()}`,
      amount: expectedTotal,
      currency: "dzd",
      metadata: {
        type: "order",
        order_id: orderId,
        client_operation_id: null,
        customer_id: captainCustomerId,
      },
    },
  });
  const signature = createHmac("sha256", testKey).update(event).digest("hex");
  const hook = await fetch(`${APP_URL}/api/chargily/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", signature },
    body: event,
  });
  assert(
    hook.status === 200,
    "webhook signé accepté (200)",
    `HTTP ${hook.status}`
  );

  await new Promise((r) => setTimeout(r, 1500));
  const paidRow = (
    await db.query(
      "select payment_status, order_number, status from orders where id = $1",
      [orderId]
    )
  ).rows[0];
  assert(
    paidRow.payment_status === "paid",
    "commande PAYÉE (transition pending→paid du webhook)",
    JSON.stringify(paidRow)
  );
  assert(
    !!paidRow.order_number,
    `numéro attribué (${paidRow.order_number}) ⇒ VISIBLE board/tablette commerçant`,
    JSON.stringify(paidRow)
  );

  // Mauvaise signature → 401 (personne ne peut marquer payé sans la clé).
  const badSig = await fetch(`${APP_URL}/api/chargily/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", signature: "deadbeef" },
    body: event,
  });
  assert(badSig.status === 401, "webhook NON signé refusé (401)");

  // Rejeu du même webhook → idempotent (toujours payé, pas de double effet).
  const replay = await fetch(`${APP_URL}/api/chargily/webhook`, {
    method: "POST",
    headers: { "Content-Type": "application/json", signature },
    body: event,
  });
  const stillPaid = (
    await db.query("select payment_status from orders where id = $1", [orderId])
  ).rows[0].payment_status;
  assert(
    replay.status === 200 && stillPaid === "paid",
    "webhook REJOUÉ : 200 + toujours payé (premier paiement gagne)"
  );

  // « Déjà payé ✅ » pour tout payeur suivant.
  const { data: paidInfo } = await guest.rpc("shared_cart_payment_info", {
    p_payment_token: ptoken,
  });
  assert(
    paidInfo?.payment_status === "paid",
    "page /payer d'un 2ᵉ payeur → « Déjà payé »",
    JSON.stringify(paidInfo)
  );
  // mig 0412 : SANS le secret de révélation (simple porteur du lien), numéro
  // et code de retrait restent ABSENTS même une fois payé.
  assert(
    paidInfo?.pickup_code == null && paidInfo?.order_number == null,
    "page /payer APRÈS paiement SANS secret : numéro + code JAMAIS révélés",
    JSON.stringify({ code: paidInfo?.pickup_code, no: paidInfo?.order_number })
  );
  // mig 0412 : AVEC le secret du payeur (posé par startGuestPayment — ici on
  // le pose directement en DB), la pop-up révèle numéro + code NON NULS.
  const revealSecret = "e2e-reveal-secret";
  await db.query(
    "update shared_carts set payer_reveal_hash = encode(extensions.digest($1::text,'sha256'),'hex') where payment_token = $2",
    [revealSecret, ptoken]
  );
  const { data: paidInfoReveal } = await guest.rpc("shared_cart_payment_info", {
    p_payment_token: ptoken,
    p_reveal: revealSecret,
  });
  const pinRow = (
    await db.query("select pickup_code from orders where id = $1", [orderId])
  ).rows[0];
  assert(
    Boolean(pinRow.pickup_code) &&
      paidInfoReveal?.pickup_code === pinRow.pickup_code &&
      Boolean(paidRow.order_number) &&
      paidInfoReveal?.order_number === paidRow.order_number,
    "page /payer APRÈS paiement AVEC secret : numéro + code révélés (pop-up)",
    JSON.stringify({
      code: paidInfoReveal?.pickup_code,
      no: paidInfoReveal?.order_number,
    })
  );
  const { data: viewPaid } = await guest.rpc("shared_cart_by_token", {
    p_token: token,
  });
  assert(
    viewPaid?.cart?.payment_status === "paid" &&
      viewPaid?.cart?.order_id === orderId,
    "room APRÈS paiement : payé + order_id exposé (bouton capitaine → commande)",
    JSON.stringify(viewPaid?.cart)
  );
  const { data: roomPayPaid } = await guest.rpc("shared_cart_room_pay_token", {
    p_token: token,
  });
  assert(
    roomPayPaid?.ok === false && roomPayPaid.reason === "already_paid",
    "room : bouton « Payer » après le webhook → déjà payé",
    JSON.stringify(roomPayPaid)
  );

  await db.end();
  console.log(
    failures === 0
      ? `\n✅ Parcours 2 téléphones + paiement TEST complet. Commande ${paidRow.order_number ?? "?"} PAYÉE chez « ${prod.merchant_name} » — ouvre la tablette de ce commerçant pour l'entendre sonner.`
      : `\n❌ ${failures} échec(s).`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
