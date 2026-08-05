// =============================================================================
// Tests de non-régression — CODES PROMO PLATEFORME + BONS D'ACHAT (mig 0292/0293)
// =============================================================================
// Vérifie, contre la VRAIE logique de prod (triggers + RPC Postgres) :
//   A. BON D'ACHAT     — l'émission crédite +V le wallet topup et débite −V le
//      platform_ledger (voucher_expense) → SUM=0 ; idempotent (voucher_id unique).
//   B. CODE PLATEFORME — à la confirmation du paiement (payment_status→paid) :
//      journal d'usage + uses_count++ + platform_ledger promo_expense=−D ;
//      idempotent ; le NET commerçant (net_total_da) reste INCHANGÉ.
//   C. VALIDATION      — plafond max_discount, online_only, min_subtotal,
//      max_uses, max_uses_per_customer.
//
// Tout s'exécute dans des transactions ROLLBACK (zéro pollution).
// Usage : node scripts/test-platform-promo-money.mjs
// =============================================================================

import pg from "pg";
import { getDbUrl } from "./_supabase.mjs";

const client = new pg.Client({
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
  await client.connect();

  const mer = await client.query(
    "select id from merchants where is_active = true order by created_at limit 1"
  );
  const cus = await client.query("select id from customers limit 1");
  if (!mer.rows[0] || !cus.rows[0]) {
    console.error("Pas de merchant/customer pour le test.");
    process.exit(1);
  }
  const merchantId = mer.rows[0].id;
  const customerId = cus.rows[0].id;

  // ===========================================================================
  // TEST A — BON D'ACHAT (crédit Coligo Pay).
  // ===========================================================================
  console.log(
    "TEST A — Bon d'achat : crédit topup +V, dépense plateforme −V, SUM=0"
  );
  await client.query("BEGIN");
  try {
    const V = 750;
    const balBefore = (
      await client.query("select public.customer_topup_balance($1)::int b", [
        customerId,
      ])
    ).rows[0].b;

    const vIns = await client.query(
      `INSERT INTO public.customer_vouchers (customer_id, amount_da, label_fr, reason)
       VALUES ($1,$2,'Test bon','gift') RETURNING id`,
      [customerId, V]
    );
    const voucherId = vIns.rows[0].id;

    const credit = await client.query(
      "select amount_da, type, source from public.customer_wallet_entries where voucher_id=$1",
      [voucherId]
    );
    assert(
      credit.rows.length === 1 &&
        credit.rows[0].amount_da === V &&
        credit.rows[0].type === "voucher_credit" &&
        credit.rows[0].source === "topup",
      `A1 crédit wallet topup +${V}`,
      JSON.stringify(credit.rows)
    );

    const balAfter = (
      await client.query("select public.customer_topup_balance($1)::int b", [
        customerId,
      ])
    ).rows[0].b;
    assert(
      balAfter - balBefore === V,
      `A2 solde topup +${V}`,
      `before=${balBefore} after=${balAfter}`
    );

    // La dépense plateforme du bon (la plus récente, order_id NULL).
    const exp = await client.query(
      `select amount_da from public.platform_ledger
       where type='voucher_expense' and order_id is null
       order by created_at desc limit 1`
    );
    assert(
      exp.rows[0] && exp.rows[0].amount_da === -V,
      `A3 platform_ledger voucher_expense = −${V}`,
      JSON.stringify(exp.rows[0])
    );
    assert(
      exp.rows[0] && credit.rows[0].amount_da + exp.rows[0].amount_da === 0,
      "A4 SUM=0 (crédit + dépense)",
      `${credit.rows[0]?.amount_da} + ${exp.rows[0]?.amount_da}`
    );

    // Idempotence : un 2e crédit avec le même voucher_id est rejeté (unique).
    let dupRejected = false;
    try {
      await client.query(
        `INSERT INTO public.customer_wallet_entries
           (customer_id, type, source, amount_da, voucher_id)
         VALUES ($1,'voucher_credit','topup',$2,$3)`,
        [customerId, V, voucherId]
      );
    } catch {
      dupRejected = true;
    }
    assert(dupRejected, "A5 double crédit même voucher_id rejeté (idempotent)");
  } finally {
    await client.query("ROLLBACK");
  }

  // ===========================================================================
  // TEST B — CODE PLATEFORME appliqué à la CONFIRMATION du paiement.
  // ===========================================================================
  console.log(
    "\nTEST B — Code plateforme : promo_expense=−D à paid, idempotent, NET intact"
  );
  await client.query("BEGIN");
  try {
    const NET = 1000;
    const D = 200;
    const pIns = await client.query(
      `INSERT INTO public.platform_promotions
         (code, title_fr, discount_kind, discount_value, online_only, audience, active)
       VALUES ('TESTPLAT', 'Test plateforme', 'amount', $1, true, 'public', true)
       RETURNING id, uses_count`,
      [D]
    );
    const promoId = pIns.rows[0].id;

    const oIns = await client.query(
      `INSERT INTO public.orders
         (merchant_id, customer_id, customer_name, customer_phone, status,
          payment_method, payment_status, pickup_type, pickup_slot_at, pickup_code,
          subtotal_da, discount_da, gross_total_da, net_total_da, total_da,
          service_fee_da, commission_da,
          platform_promo_id, platform_promo_code, platform_discount_da)
       VALUES ($1,$2,'TEST PLAT','+213000000000','pending',
          'online','pending','asap', now() + interval '30 min', 'TSTPLT',
          $3,0,$3,$3,$4, 0,0, $5,'TESTPLAT',$6)
       RETURNING id`,
      [merchantId, customerId, NET, NET - D, promoId, D]
    );
    const orderId = oIns.rows[0].id;

    // Confirmation du paiement → trigger apply_platform_promo_on_paid.
    await client.query(
      "update public.orders set payment_status='paid' where id=$1",
      [orderId]
    );

    const red = await client.query(
      "select discount_da from public.platform_promotion_redemptions where order_id=$1",
      [orderId]
    );
    assert(
      red.rows.length === 1 && red.rows[0].discount_da === D,
      `B1 journal d'usage créé (discount=${D})`,
      JSON.stringify(red.rows)
    );

    const uses = (
      await client.query(
        "select uses_count from public.platform_promotions where id=$1",
        [promoId]
      )
    ).rows[0].uses_count;
    assert(uses === 1, "B2 uses_count incrémenté à 1", `obtenu ${uses}`);

    const exp = await client.query(
      "select amount_da from public.platform_ledger where order_id=$1 and type='promo_expense'",
      [orderId]
    );
    assert(
      exp.rows[0] && exp.rows[0].amount_da === -D,
      `B3 platform_ledger promo_expense = −${D}`,
      JSON.stringify(exp.rows[0])
    );

    const net = (
      await client.query("select net_total_da from public.orders where id=$1", [
        orderId,
      ])
    ).rows[0].net_total_da;
    assert(
      net === NET,
      `B4 net_total_da (NET commerçant) INCHANGÉ = ${NET}`,
      `obtenu ${net}`
    );

    // Idempotence : re-bascule pending→paid → aucune 2e écriture.
    await client.query(
      "update public.orders set payment_status='pending' where id=$1",
      [orderId]
    );
    await client.query(
      "update public.orders set payment_status='paid' where id=$1",
      [orderId]
    );
    const uses2 = (
      await client.query(
        "select uses_count from public.platform_promotions where id=$1",
        [promoId]
      )
    ).rows[0].uses_count;
    const expCount = (
      await client.query(
        "select count(*)::int c from public.platform_ledger where order_id=$1 and type='promo_expense'",
        [orderId]
      )
    ).rows[0].c;
    assert(
      uses2 === 1,
      "B5 idempotent : uses_count reste 1",
      `obtenu ${uses2}`
    );
    assert(
      expCount === 1,
      "B6 idempotent : une seule dépense",
      `obtenu ${expCount}`
    );
  } finally {
    await client.query("ROLLBACK");
  }

  // ===========================================================================
  // TEST C — VALIDATION (plafond, online_only, min, plafonds d'usage).
  // ===========================================================================
  console.log("\nTEST C — validate_platform_promo : règles & plafonds");
  await client.query("BEGIN");
  try {
    const pIns = await client.query(
      `INSERT INTO public.platform_promotions
         (code, title_fr, discount_kind, discount_value, max_discount_da,
          min_subtotal_da, online_only, audience, active, max_uses,
          max_uses_per_customer)
       VALUES ('PCT50','Moitié','percent',50,300,500,true,'public',true,100,2)
       RETURNING id`
    );
    const promoId = pIns.rows[0].id;
    const val = (code, sub, method) =>
      client.query(
        "select * from public.validate_platform_promo($1,$2,$3,$4)",
        [code, customerId, sub, method]
      );

    // 50% de 1000 = 500, plafonné à 300.
    let r = (await val("PCT50", 1000, "online")).rows[0];
    assert(
      r.valid === true && r.discount_da === 300,
      "C1 remise % plafonnée à max_discount_da (300)",
      JSON.stringify(r)
    );

    // En espèces → refus online_only.
    r = (await val("PCT50", 1000, "cash")).rows[0];
    assert(
      r.valid === false && r.reason === "online_only",
      "C2 refus en espèces (online_only)",
      JSON.stringify(r)
    );

    // Sous le minimum → refus.
    r = (await val("PCT50", 400, "online")).rows[0];
    assert(
      r.valid === false && r.reason === "min_subtotal",
      "C3 refus sous le minimum (500)",
      JSON.stringify(r)
    );

    // Épuisé (uses_count >= max_uses).
    await client.query(
      "update public.platform_promotions set uses_count=100 where id=$1",
      [promoId]
    );
    r = (await val("PCT50", 1000, "online")).rows[0];
    assert(
      r.valid === false && r.reason === "exhausted",
      "C4 refus plafond global atteint",
      JSON.stringify(r)
    );

    // Plafond par client : 2 usages déjà enregistrés.
    await client.query(
      "update public.platform_promotions set uses_count=0 where id=$1",
      [promoId]
    );
    // Besoin de 2 redemptions de ce client → nécessite des commandes (FK). On
    // crée 2 commandes minimales et leurs redemptions.
    for (let i = 0; i < 2; i++) {
      const o = await client.query(
        `INSERT INTO public.orders
           (merchant_id, customer_id, customer_name, customer_phone, status,
            payment_method, payment_status, pickup_type, pickup_slot_at, pickup_code,
            subtotal_da, total_da)
         VALUES ($1,$2,'T','+213000000000','pending','online','pending','asap',
            now()+interval '30 min', $3, 1000, 1000) RETURNING id`,
        [merchantId, customerId, `PCC${i}`]
      );
      await client.query(
        `INSERT INTO public.platform_promotion_redemptions
           (promotion_id, order_id, customer_id, code, discount_da)
         VALUES ($1,$2,$3,'PCT50',300)`,
        [promoId, o.rows[0].id, customerId]
      );
    }
    r = (await val("PCT50", 1000, "online")).rows[0];
    assert(
      r.valid === false && r.reason === "per_customer_limit",
      "C5 refus plafond par client atteint (2/2)",
      JSON.stringify(r)
    );
  } finally {
    await client.query("ROLLBACK");
  }

  // ===========================================================================
  // TEST D — MOTIFS PRÉCIS (mig 0436) + PLAFOND PAR APPAREIL configurable.
  // ===========================================================================
  console.log(
    "\nTEST D — motifs not_started/expired + plafond appareil (mig 0436)"
  );
  await client.query("BEGIN");
  try {
    const custs = await client.query(
      "select id from customers order by created_at limit 3"
    );
    const [cA, cB, cC] = custs.rows.map((r) => r.id);

    const dIns = await client.query(
      `INSERT INTO public.platform_promotions
         (code, title_fr, discount_kind, discount_value, online_only,
          audience, active, app_only, max_uses_per_device)
       VALUES ('DEVCAP','Appareil','amount',100,false,'public',true,false,1)
       RETURNING id`
    );
    const dPromoId = dIns.rows[0].id;
    const val6 = (code, cust, isApp, device) =>
      client.query(
        "select * from public.validate_platform_promo($1,$2,$3,$4,$5,$6)",
        [code, cust, 1000, "online", isApp, device]
      );

    // D1 — pas encore commencé : motif DÉDIÉ + date de début renvoyée
    // (le bug vécu APP20 : « inactive » fourre-tout → message trompeur).
    await client.query(
      "update public.platform_promotions set starts_at = now() + interval '1 day' where id=$1",
      [dPromoId]
    );
    let r = (await val6("DEVCAP", cA, false, null)).rows[0];
    assert(
      r.valid === false && r.reason === "not_started" && r.starts_at != null,
      "D1 code pas commencé → not_started + date de début",
      JSON.stringify(r)
    );

    // D2 — expiré : motif dédié.
    await client.query(
      "update public.platform_promotions set starts_at = null, ends_at = now() - interval '1 day' where id=$1",
      [dPromoId]
    );
    r = (await val6("DEVCAP", cA, false, null)).rows[0];
    assert(
      r.valid === false && r.reason === "expired",
      "D2 code expiré → expired",
      JSON.stringify(r)
    );

    // D3 — désactivé : « inactive » ne sert plus qu'à ça.
    await client.query(
      "update public.platform_promotions set ends_at = null, active = false where id=$1",
      [dPromoId]
    );
    r = (await val6("DEVCAP", cA, false, null)).rows[0];
    assert(
      r.valid === false && r.reason === "inactive",
      "D3 code désactivé → inactive",
      JSON.stringify(r)
    );
    await client.query(
      "update public.platform_promotions set active = true where id=$1",
      [dPromoId]
    );

    // D4 — plafond appareil 1 : l'appareil a déjà servi le compte A →
    // le compte B est refusé sur le MÊME appareil.
    await client.query(
      `INSERT INTO public.platform_promo_device_marks
         (promotion_id, device_id, customer_id) VALUES ($1,'nat:e2e-device',$2)`,
      [dPromoId, cA]
    );
    r = (await val6("DEVCAP", cB, false, "nat:e2e-device")).rows[0];
    assert(
      r.valid === false && r.reason === "device_used",
      "D4 cap appareil 1 : 2e compte refusé sur le même téléphone",
      JSON.stringify(r)
    );

    // D5 — le compte A (déjà servi) n'est PAS bloqué par l'appareil : lui
    // reste régi par max_uses_per_customer.
    r = (await val6("DEVCAP", cA, false, "nat:e2e-device")).rows[0];
    assert(
      r.valid === true,
      "D5 le compte déjà servi reste régi par per_customer_limit",
      JSON.stringify(r)
    );

    // D6 — cap relevé à 2 : le compte B passe désormais.
    await client.query(
      "update public.platform_promotions set max_uses_per_device = 2 where id=$1",
      [dPromoId]
    );
    r = (await val6("DEVCAP", cB, false, "nat:e2e-device")).rows[0];
    assert(
      r.valid === true,
      "D6 cap appareil 2 : le 2e compte passe",
      JSON.stringify(r)
    );

    // D7 — B marqué aussi : le 3e compte est refusé (2 comptes déjà servis).
    await client.query(
      `INSERT INTO public.platform_promo_device_marks
         (promotion_id, device_id, customer_id) VALUES ($1,'nat:e2e-device',$2)`,
      [dPromoId, cB]
    );
    r = (await val6("DEVCAP", cC, false, "nat:e2e-device")).rows[0];
    assert(
      r.valid === false && r.reason === "device_used",
      "D7 cap appareil 2 : le 3e compte est refusé",
      JSON.stringify(r)
    );

    // D8 — cap NULL = pas de limite appareil : le 3e compte passe.
    await client.query(
      "update public.platform_promotions set max_uses_per_device = null where id=$1",
      [dPromoId]
    );
    r = (await val6("DEVCAP", cC, false, "nat:e2e-device")).rows[0];
    assert(
      r.valid === true,
      "D8 cap NULL : plus de limite appareil",
      JSON.stringify(r)
    );

    // D9 — app_only : refusé hors app, accepté avec le drapeau serveur.
    await client.query(
      "update public.platform_promotions set app_only = true where id=$1",
      [dPromoId]
    );
    r = (await val6("DEVCAP", cC, false, null)).rows[0];
    assert(
      r.valid === false && r.reason === "app_only",
      "D9a app_only : refusé hors application",
      JSON.stringify(r)
    );
    r = (await val6("DEVCAP", cC, true, null)).rows[0];
    assert(
      r.valid === true,
      "D9b app_only : accepté dans l'application",
      JSON.stringify(r)
    );
  } finally {
    await client.query("ROLLBACK");
  }

  console.log(
    failures === 0
      ? "\n✅ Tous les tests passent."
      : `\n❌ ${failures} test(s) en échec.`
  );
  await client.end();
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
