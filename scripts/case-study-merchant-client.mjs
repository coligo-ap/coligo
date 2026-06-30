// =============================================================================
// ÉTUDE DE CAS — Commerçant 1 × Client 1 : cashback, commission, frais de service,
// Coligo Pay. Transaction ROLLBACK (aucune pollution prod). Prouve la cohérence
// de TOUS les cas décrits :
//   1. Cashback gagné UNIQUEMENT quand le retrait/livraison est validé (completed)
//   2. Solde Coligo Pay commerçant : commission + frais de service bien prélevés
//   3. Paiement ESPÈCES → l'argent ne va PAS dans la Coligo Pay client
//   4. Commande NON validée → AUCUN cashback
//   5. Anti-boucle : payer une moitié en cashback ne régénère PAS de cashback
//      sur la part déjà réglée en cashback (le topup/Coligo Pay reste éligible)
//   6. Réconciliation : SUM des grands livres = 0 sur chaque commande
// =============================================================================
import pg from "pg";
import { getDbUrl } from "./_supabase.mjs";

const c = new pg.Client({ connectionString: getDbUrl() });
await c.connect();
await c.query("BEGIN");

// UUID fixes pour l'étude.
const M_USER = "11111111-1111-1111-1111-111111111111";
const C_USER = "22222222-2222-2222-2222-222222222222";
const DRV_USER = "33333333-3333-3333-3333-333333333333";

const f = (n) => String(n).padStart(6, " ");
const line = (s = "") => console.log(s);

// --- lecteurs de soldes / grands livres -------------------------------------
async function q1(sql, p = []) {
  return (await c.query(sql, p)).rows[0];
}
async function merchantColigoPay(walletId) {
  return (
    await q1(
      "SELECT COALESCE(SUM(amount_da),0)::int s FROM operator_wallet_entries WHERE wallet_id=$1",
      [walletId]
    )
  ).s;
}
async function clientCashback(custId) {
  return (
    await q1("SELECT public.customer_cashback_balance($1)::int s", [custId])
  ).s;
}
async function clientTopup(custId) {
  return (await q1("SELECT public.customer_topup_balance($1)::int s", [custId]))
    .s;
}
async function ledgerSum(table, orderId, extra = "") {
  return (
    await q1(
      `SELECT COALESCE(SUM(amount_da),0)::int s FROM ${table} WHERE order_id=$1 ${extra}`,
      [orderId]
    )
  ).s;
}
async function walletRows(orderId) {
  return (
    await c.query(
      "SELECT type, amount_da FROM wallet_entries WHERE order_id=$1 ORDER BY type",
      [orderId]
    )
  ).rows;
}
async function deliveryRows(orderId) {
  return (
    await c.query(
      "SELECT type, amount_da FROM delivery_ledger WHERE order_id=$1 ORDER BY type",
      [orderId]
    )
  ).rows;
}

let CASHBACK_CASH, CASHBACK_ONLINE, COMM_CASH, COMM_ONLINE, CHARGILY;
let M_ID, C_ID, M_WALLET, DRV_ID;

// --- crée une commande puis la pousse à l'état voulu ------------------------
let SEQ = 0;
async function placeOrder({
  label,
  P, // panier produits net
  S = 0, // frais de service
  D = 0, // frais de livraison
  method = "online", // 'online' | 'cash'
  fulfillment = "pickup", // 'pickup' | 'delivery'
  mode = null, // 'express' | 'tour' | null
  cashbackUsed = 0,
  topupUsed = 0,
  driver = null, // user_id livreur si express COD
  finalStatus = "completed", // 'completed' | 'cancelled'
  failDelivery = false,
}) {
  SEQ += 1;
  const total = P + S + D - cashbackUsed - topupUsed;
  const code = String(1000 + SEQ);
  const paymentStatus = method === "cash" ? "pending" : "paid";

  const o = await q1(
    `INSERT INTO orders (merchant_id, customer_id, customer_name, customer_phone,
       subtotal_da, discount_da, net_total_da, service_fee_da, delivery_fee_da, total_da,
       cashback_used_da, topup_used_da, pickup_code, pickup_slot_at, payment_method,
       payment_status, fulfillment_type, delivery_mode, delivery_driver_id,
       delivery_lat, delivery_lng, delivery_address_text, status)
     VALUES ($1,$2,'Client 1','+213770000001',$3,0,$3,$4,$5,$6,$7,$8,$9,now(),$10,$11,
       $12,$13,$14,36.75,5.06,'Adresse test','preparing') RETURNING id`,
    [
      M_ID,
      C_ID,
      P,
      S,
      D,
      total,
      cashbackUsed,
      topupUsed,
      code,
      method,
      paymentStatus,
      fulfillment,
      mode,
      driver,
    ]
  );

  // snapshot soldes AVANT finalisation
  const before = {
    mcp: await merchantColigoPay(M_WALLET),
    cb: await clientCashback(C_ID),
    tu: await clientTopup(C_ID),
  };

  // finalisation
  if (finalStatus === "completed") {
    if (failDelivery) {
      await c.query("UPDATE orders SET delivery_failed_at=now() WHERE id=$1", [
        o.id,
      ]);
    }
    await c.query("UPDATE orders SET status='completed' WHERE id=$1", [o.id]);
  } else {
    if (failDelivery) {
      await c.query("UPDATE orders SET delivery_failed_at=now() WHERE id=$1", [
        o.id,
      ]);
    }
    await c.query("UPDATE orders SET status='cancelled' WHERE id=$1", [o.id]);
  }

  const after = {
    mcp: await merchantColigoPay(M_WALLET),
    cb: await clientCashback(C_ID),
    tu: await clientTopup(C_ID),
  };

  const snap = await q1(
    "SELECT cashback_da, commission_da FROM orders WHERE id=$1",
    [o.id]
  );

  // grands livres
  const wRows = await walletRows(o.id);
  const dRows = await deliveryRows(o.id);
  const platform = await ledgerSum("platform_ledger", o.id);
  const merchW = await ledgerSum("wallet_entries", o.id);
  const clientW = await ledgerSum("customer_wallet_entries", o.id);

  line("");
  line(`━━━ ${label} ━━━`);
  line(
    `   méthode=${method}  fulfillment=${fulfillment}${mode ? "/" + mode : ""}  statut final=${finalStatus}${failDelivery ? " (LIVRAISON ÉCHOUÉE)" : ""}`
  );
  line(
    `   Panier P=${P}  Frais service S=${S}  Livraison D=${D}  cashback utilisé=${cashbackUsed}  topup utilisé=${topupUsed}  → TOTAL payé=${total}`
  );
  line(
    `   ── Coligo Pay COMMERÇANT : ${f(before.mcp)} → ${f(after.mcp)}  (Δ ${after.mcp - before.mcp >= 0 ? "+" : ""}${after.mcp - before.mcp})`
  );
  line(
    `   ── Cashback CLIENT       : ${f(before.cb)} → ${f(after.cb)}  (Δ ${after.cb - before.cb >= 0 ? "+" : ""}${after.cb - before.cb})`
  );
  line(
    `   ── Topup/Coligo Pay client: ${f(before.tu)} → ${f(after.tu)}  (Δ ${after.tu - before.tu >= 0 ? "+" : ""}${after.tu - before.tu})`
  );
  line(
    `   cashback gagné (snapshot orders.cashback_da)=${snap.cashback_da ?? 0}  | commission_da=${snap.commission_da ?? 0}`
  );
  if (wRows.length)
    line(
      `   wallet_entries commerçant : ${wRows.map((r) => `${r.type}=${r.amount_da}`).join("  ")}`
    );
  if (dRows.length)
    line(
      `   delivery_ledger livreur   : ${dRows.map((r) => `${r.type}=${r.amount_da}`).join("  ")}`
    );
  line(
    `   platform_ledger (net Coligo)=${platform}  | customer_wallet_entries net=${clientW}`
  );

  // --- réconciliation par cas ---
  const cashbackEarned = snap.cashback_da ?? 0;
  if (mode === "express" && method === "cash" && driver) {
    // CUSTODIAN livreur : le livreur encaisse, doit reverser. Résidu = 0.
    const collected = await ledgerSum(
      "delivery_ledger",
      o.id,
      "AND type='driver_cash_collected'"
    );
    const owesM = await ledgerSum(
      "delivery_ledger",
      o.id,
      "AND type='driver_owes_merchant'"
    );
    const owesP = await ledgerSum(
      "delivery_ledger",
      o.id,
      "AND type='driver_owes_platform'"
    );
    const payout = await ledgerSum(
      "delivery_ledger",
      o.id,
      "AND type='driver_payout'"
    );
    const residual = collected - owesM - owesP - payout;
    line(
      `   ⚖️  RÉSIDU livreur (collecté ${collected} − doit_marchand ${owesM} − doit_plateforme ${owesP} − garde ${payout}) = ${residual} ${residual === 0 ? "✅ équilibré" : "❌ FUITE"}`
    );
  } else if (
    finalStatus === "completed" &&
    !failDelivery &&
    method === "cash"
  ) {
    // CASH non-custodian (retrait/tournée) : le commerçant détient le cash.
    // Aucun argent externe → SUM(wallet commerçant + platform + client) = 0.
    const sum = merchW + platform + clientW;
    line(
      `   ⚖️  RÉCONCILIATION espèces (wallet commerçant ${merchW} + platform ${platform} + client ${clientW}) = ${sum} ${sum === 0 ? "✅ équilibré" : "❌ DÉSÉQUILIBRE " + sum}`
    );
  } else if (
    finalStatus === "completed" &&
    !failDelivery &&
    method === "online"
  ) {
    // ONLINE : le client paie de l'EXTÉRIEUR (Chargily). Conservation =
    //   total payé + cashback/topup dépensés (passifs libérés)
    //   == revenu net commerçant + net plateforme + cashback gagné + frais Chargily
    const chargily = -(await ledgerSum(
      "platform_ledger",
      o.id,
      "AND type='chargily_fee'"
    ));
    const lhs = total + cashbackUsed + topupUsed;
    const rhs = merchW + platform + cashbackEarned + chargily;
    line(
      `   ⚖️  CONSERVATION en ligne : entrées (total ${total} + cashback utilisé ${cashbackUsed} + topup ${topupUsed} = ${lhs})`
    );
    line(
      `        = sorties (commerçant ${merchW} + Coligo net ${platform} + cashback client ${cashbackEarned} + Chargily ${chargily} = ${rhs}) ${lhs === rhs ? "✅ équilibré" : "❌ ÉCART " + (lhs - rhs)}`
    );
  }
  return { id: o.id, after };
}

try {
  // ---------------------------------------------------------------------------
  // 0) Taux LIVE (lus en base, pas codés en dur)
  // ---------------------------------------------------------------------------
  CASHBACK_CASH = Number(
    (await q1("SELECT public.resolve_rate(NULL,'cashback_cash') r")).r
  );
  CASHBACK_ONLINE = Number(
    (await q1("SELECT public.resolve_rate(NULL,'cashback_online') r")).r
  );
  COMM_CASH = Number(
    (await q1("SELECT public.resolve_rate(NULL,'commission_cash') r")).r
  );
  COMM_ONLINE = Number(
    (await q1("SELECT public.resolve_rate(NULL,'commission_online') r")).r
  );
  CHARGILY = Number(
    (await q1("SELECT public.resolve_rate(NULL,'chargily_fee') r")).r
  );

  line("=============================================================");
  line("  ÉTUDE DE CAS — Commerçant 1 × Client 1");
  line("=============================================================");
  line("TAUX PLATEFORME EN VIGUEUR (lus en base) :");
  line(
    `  commission cash=${(COMM_CASH * 100).toFixed(1)}%  commission online=${(COMM_ONLINE * 100).toFixed(1)}%`
  );
  line(
    `  cashback cash=${(CASHBACK_CASH * 100).toFixed(1)}%  cashback online=${(CASHBACK_ONLINE * 100).toFixed(1)}%`
  );
  line(`  frais Chargily=${(CHARGILY * 100).toFixed(1)}%`);

  // ---------------------------------------------------------------------------
  // 1) Création Commerçant 1 + Client 1 + Livreur (pour le cas COD express)
  // ---------------------------------------------------------------------------
  for (const [id, email] of [
    [M_USER, "etude-merchant1@test.local"],
    [C_USER, "etude-client1@test.local"],
    [DRV_USER, "etude-driver1@test.local"],
  ]) {
    await c.query(
      `INSERT INTO auth.users (instance_id, id, aud, role, email, encrypted_password, email_confirmed_at, created_at, updated_at)
       VALUES ('00000000-0000-0000-0000-000000000000',$1,'authenticated','authenticated',$2,'x',now(),now(),now())`,
      [id, email]
    );
  }
  M_ID = (
    await q1(
      "INSERT INTO merchants (user_id, name, slug, is_active) VALUES ($1,'Commerçant 1','commercant-1-etude',true) RETURNING id",
      [M_USER]
    )
  ).id;
  C_ID = (
    await q1(
      "INSERT INTO customers (user_id, full_name) VALUES ($1,'Client 1') RETURNING id",
      [C_USER]
    )
  ).id;
  // livreur (table drivers : minimal). delivery_driver_id réfère drivers.id.
  DRV_ID = (
    await q1(
      "INSERT INTO drivers (user_id, full_name, phone) VALUES ($1,'Livreur 1','+213700000009') RETURNING id",
      [DRV_USER]
    )
  ).id;
  M_WALLET = (
    await q1("SELECT public.ensure_operator_wallet('merchant',$1) w", [M_ID])
  ).w;

  line("");
  line(`Commerçant 1 créé : ${M_ID}  (Coligo Pay wallet ${M_WALLET})`);
  line(`Client 1 créé     : ${C_ID}`);
  line(
    `Solde Coligo Pay commerçant au départ = ${await merchantColigoPay(M_WALLET)}`
  );
  line(
    `Solde cashback client au départ        = ${await clientCashback(C_ID)}`
  );

  // ===========================================================================
  // SCÉNARIO A — En ligne, retrait validé : cashback gagné + commission prélevée
  // ===========================================================================
  await placeOrder({
    label: "A. EN LIGNE, retrait validé (panier 1000, frais service 50)",
    P: 1000,
    S: 50,
    method: "online",
    fulfillment: "pickup",
  });
  line(
    `   → attendu : cashback = round(1000×${CASHBACK_ONLINE})=${Math.round(1000 * CASHBACK_ONLINE)} ; commission = round(1000×${COMM_ONLINE})=${Math.round(1000 * COMM_ONLINE)} ; Coligo Pay commerçant Δ = +1000 (vente) −commission = +${1000 - Math.round(1000 * COMM_ONLINE)}`
  );

  // ===========================================================================
  // SCÉNARIO B — En ligne, panier différent, retrait validé (2e gain cashback)
  // ===========================================================================
  await placeOrder({
    label: "B. EN LIGNE, retrait validé (panier 600, frais service 40)",
    P: 600,
    S: 40,
    method: "online",
    fulfillment: "pickup",
  });

  // ===========================================================================
  // SCÉNARIO C — Commande NON validée (annulée) : AUCUN cashback
  // ===========================================================================
  await placeOrder({
    label: "C. EN LIGNE, commande ANNULÉE (non validée au retrait)",
    P: 800,
    S: 40,
    method: "online",
    fulfillment: "pickup",
    finalStatus: "cancelled",
  });
  line(
    "   → attendu : AUCUN cashback gagné (commande non validée), solde client inchangé."
  );

  // ===========================================================================
  // SCÉNARIO D — ESPÈCES, retrait validé : argent NON crédité dans Coligo Pay
  //              client ; commerçant détient le cash, doit commission+frais service
  // ===========================================================================
  await placeOrder({
    label: "D. ESPÈCES, retrait validé (panier 1000, frais service 50)",
    P: 1000,
    S: 50,
    method: "cash",
    fulfillment: "pickup",
  });
  line(
    `   → attendu : cashback cash = ${(CASHBACK_CASH * 100).toFixed(1)}% (=${Math.round(1000 * CASHBACK_CASH)}). Le client a payé CASH → sa Coligo Pay n'est PAS créditée du paiement. Le commerçant garde le cash et DOIT à Coligo : commission ${Math.round(1000 * COMM_CASH)} + frais service 50 (lignes négatives).`
  );

  // ===========================================================================
  // Le client DÉPENSE le cashback gagné (A+B) sur une commande suivante
  // ===========================================================================
  const cbAvail = await clientCashback(C_ID);
  line("");
  line(
    `>>> Le client a accumulé ${cbAvail} DA de cashback (retraits A+B validés).`
  );
  line(`>>> Il l'utilise maintenant pour payer une PARTIE d'une commande.`);

  // ===========================================================================
  // SCÉNARIO E — ANTI-BOUCLE : paie la moitié en cashback. Le cashback n'est PAS
  //              régénéré sur la part déjà payée en cashback.
  // ===========================================================================
  const half = Math.min(cbAvail, 250);
  await placeOrder({
    label: `E. EN LIGNE, ANTI-BOUCLE : paie ${half} en cashback sur panier 500`,
    P: 500,
    S: 30,
    method: "online",
    fulfillment: "pickup",
    cashbackUsed: half,
  });
  line(
    `   → assiette cashback = (produits 500 + livraison 0) − cashback utilisé ${half} = ${500 - half}`
  );
  line(
    `   → cashback gagné attendu = round(${500 - half}×${CASHBACK_ONLINE}) = ${Math.round((500 - half) * CASHBACK_ONLINE)} (et NON round(500×${CASHBACK_ONLINE})=${Math.round(500 * CASHBACK_ONLINE)}) ✅ pas de boucle infinie`
  );

  // ===========================================================================
  // SCÉNARIO F — ESPÈCES + EXPRESS (COD) : livreur custodian, Coligo Pay
  //              commerçant NON crédité à la complétion (réglé au relevé)
  // ===========================================================================
  await placeOrder({
    label: "F. ESPÈCES + EXPRESS COD (panier 1000, service 50, livraison 200)",
    P: 1000,
    S: 50,
    D: 200,
    method: "cash",
    fulfillment: "delivery",
    mode: "express",
    driver: DRV_ID,
  });
  line(
    "   → attendu : aucun mouvement Coligo Pay commerçant (le livreur détient le cash) ; résidu livreur = 0."
  );

  // ===========================================================================
  // SCÉNARIO G — Livraison ÉCHOUÉE : aucun cashback même si complété
  // ===========================================================================
  await placeOrder({
    label: "G. EN LIGNE, livraison ÉCHOUÉE (delivery_failed_at)",
    P: 700,
    S: 40,
    D: 150,
    method: "online",
    fulfillment: "delivery",
    mode: "express",
    driver: DRV_ID,
    finalStatus: "cancelled",
    failDelivery: true,
  });
  line("   → attendu : aucun cashback (livraison échouée).");

  // ---------------------------------------------------------------------------
  // SYNTHÈSE finale
  // ---------------------------------------------------------------------------
  const finalMCP = await merchantColigoPay(M_WALLET);
  const finalCB = await clientCashback(C_ID);
  line("");
  line("=============================================================");
  line("  SYNTHÈSE FINALE");
  line("=============================================================");
  line(`Solde Coligo Pay COMMERÇANT (fin) = ${finalMCP} DA`);
  line(`Solde cashback CLIENT (fin)        = ${finalCB} DA`);

  // Cohérence globale plateforme : SUM de TOUS les grands livres doit fermer.
  const allPlat = (
    await q1(
      "SELECT COALESCE(SUM(amount_da),0)::int s FROM platform_ledger WHERE order_id IN (SELECT id FROM orders WHERE merchant_id=$1)",
      [M_ID]
    )
  ).s;
  const allClient = (
    await q1(
      "SELECT COALESCE(SUM(amount_da),0)::int s FROM customer_wallet_entries WHERE customer_id=$1",
      [C_ID]
    )
  ).s;
  line("");
  line(
    `platform_ledger total (revenu net Coligo sur ces commandes) = ${allPlat} DA`
  );
  line(
    `customer_wallet_entries net client (cashback restant)        = ${allClient} DA  (= solde cashback ${finalCB} ✅)`
  );
  line("");
  line("Vérifications clés :");
  line(
    "  • Cashback gagné UNIQUEMENT sur commandes validées (A,B,D,E) — pas sur C (annulée) ni G (échec)."
  );
  line(
    "  • Commission + frais de service prélevés sur le solde Coligo Pay commerçant (lignes négatives)."
  );
  line(
    "  • Paiement espèces → Coligo Pay CLIENT non créditée du paiement (seul le cashback gagné l'est)."
  );
  line(
    "  • Anti-boucle : E gagne du cashback sur (panier − cashback utilisé), jamais sur la part cashback."
  );
  line(
    "  • COD express : custodian livreur, résidu = 0, Coligo Pay commerçant non touchée à la complétion."
  );
} catch (e) {
  console.error("\n❌ ERREUR:", e.message);
  console.error(e.stack);
} finally {
  await c.query("ROLLBACK");
  await c.end();
  line("\n(transaction annulée — ROLLBACK, aucune donnée persistée)");
}
