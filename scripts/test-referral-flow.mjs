// =============================================================================
// Tests de non-régression — PARRAINAGE CLIENT (mig 0403/0404)
// =============================================================================
// Vérifie, contre la VRAIE logique de prod (triggers + RPC Postgres) :
//   A. ATTRIBUTION  — attach_referral : ok / already_referred / self_referral /
//      unknown_code / disabled.
//   B. QUALIFICATION — commande `completed` : sous le minimum → reste pending ;
//      au-dessus → rewarded + 2 crédits wallet (source topup) + 2 dépenses
//      platform_ledger (SUM=0) ; le plafond de recharge 30 j (0241) est INSENSIBLE
//      au type referral_credit ; idempotence stricte (index unique).
//   C. ANTI-FRAUDE  — même appareil (IP+UA) parrain/filleul → `held`, zéro
//      crédit ; approbation admin (RPC réelle, claims JWT simulées) → crédit.
//   D. RÉVOCATION   — admin_revoke_referral : contre-passation, soldes rendus.
//   E. EXPIRATION   — expire_referrals() passe les pending périmés en expired.
//   F. INTÉGRITÉ    — integrity_violations() : zéro invariant parrainage violé.
//
// Tout s'exécute dans UNE transaction ROLLBACK (zéro pollution).
// Puis phase ANON (client supabase-js, clé anon) : seules les RPC prévues
// répondent, tout le reste est refusé.
// Usage : node scripts/test-referral-flow.mjs
// =============================================================================

import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { getDbUrl, loadEnvLocal } from "./_supabase.mjs";

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

const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
function randomCode() {
  let s = "";
  for (let i = 0; i < 8; i++)
    s += ALPHABET[Math.floor(Math.random() * ALPHABET.length)];
  return s;
}

async function main() {
  await client.connect();

  // ── Fixtures : 1 commerçant, 1 parrain, 3 filleuls SANS commande honorée ──
  const mer = await client.query(
    "select id from merchants where is_active = true order by created_at limit 1"
  );
  const referrer = await client.query(
    `select c.id, c.user_id from customers c
      where c.user_id is not null
      order by c.created_at limit 1`
  );
  const referees = await client.query(
    `select c.id, c.user_id from customers c
      where c.id <> $1 and c.user_id is not null
        and not exists (select 1 from orders o
                         where o.customer_id = c.id and o.status = 'completed')
      order by c.created_at limit 3`,
    [referrer.rows[0]?.id]
  );
  if (!mer.rows[0] || !referrer.rows[0] || referees.rows.length < 3) {
    console.error(
      "Fixtures insuffisantes : il faut 1 merchant actif, 1 parrain et 3 clients sans commande honorée."
    );
    process.exit(1);
  }
  const merchantId = mer.rows[0].id;
  const REF = referrer.rows[0]; // parrain
  const [F1, F2, F3] = referees.rows; // filleuls

  const admin = await client.query(
    `select email from platform_admins
      where is_active and (role = 'owner' or 'marketing' = any(domains))
      limit 1`
  );
  if (!admin.rows[0]) {
    console.error("Aucun admin actif avec le domaine marketing.");
    process.exit(1);
  }
  const adminEmail = admin.rows[0].email;

  await client.query("BEGIN");
  try {
    // Programme actif le temps du test (rollback à la fin).
    await client.query(
      "update referral_settings set enabled = true, reward_referrer_da = 300, reward_referee_da = 300, min_order_da = 500, max_referrals_month = 20 where id = 1"
    );
    await client.query(
      "update feature_flags set status = 'active' where key = 'referral'"
    );

    const code = randomCode();
    await client.query(
      "insert into customer_referral_codes (customer_id, code) values ($1, $2)",
      [REF.id, code]
    );

    // =========================================================================
    console.log("TEST A — attach_referral : règles d'attribution");
    // =========================================================================
    let r = (
      await client.query("select public.attach_referral($1, $2) j", [
        F1.id,
        code,
      ])
    ).rows[0].j;
    assert(
      r.ok === true,
      "A1 attribution filleul 1 acceptée",
      JSON.stringify(r)
    );

    r = (
      await client.query("select public.attach_referral($1, $2) j", [
        F1.id,
        code,
      ])
    ).rows[0].j;
    assert(
      r.ok === false && r.reason === "already_referred",
      "A2 refus double attribution du même filleul",
      JSON.stringify(r)
    );

    r = (
      await client.query("select public.attach_referral($1, $2) j", [
        REF.id,
        code,
      ])
    ).rows[0].j;
    assert(
      r.ok === false && r.reason === "self_referral",
      "A3 refus auto-parrainage",
      JSON.stringify(r)
    );

    r = (
      await client.query("select public.attach_referral($1, 'ZZZZZZZ2') j", [
        F2.id,
      ])
    ).rows[0].j;
    assert(
      r.ok === false && r.reason === "unknown_code",
      "A4 refus code inconnu",
      JSON.stringify(r)
    );

    await client.query(
      "update referral_settings set enabled = false where id = 1"
    );
    r = (
      await client.query("select public.attach_referral($1, $2) j", [
        F2.id,
        code,
      ])
    ).rows[0].j;
    assert(
      r.ok === false && r.reason === "disabled",
      "A5 refus programme désactivé",
      JSON.stringify(r)
    );
    await client.query(
      "update referral_settings set enabled = true where id = 1"
    );

    // =========================================================================
    console.log("TEST B — qualification + crédit double + plafond 0241");
    // =========================================================================
    const bal = async (cid) =>
      (
        await client.query("select public.customer_topup_balance($1)::int b", [
          cid,
        ])
      ).rows[0].b;
    const cap30 = async (cid) =>
      (
        await client.query(
          "select public.customer_topup_credited_last_30d($1)::int b",
          [cid]
        )
      ).rows[0].b;

    const refBal0 = await bal(REF.id);
    const f1Bal0 = await bal(F1.id);
    const refCap0 = await cap30(REF.id);
    const f1Cap0 = await cap30(F1.id);

    const mkOrder = async (cid, total, pin) =>
      (
        await client.query(
          `insert into public.orders
             (merchant_id, customer_id, customer_name, customer_phone, status,
              payment_method, payment_status, pickup_type, pickup_slot_at,
              pickup_code, subtotal_da, total_da)
           values ($1, $2, 'TEST REF', '+213000000000', 'pending',
              'cash', 'pending', 'asap', now() + interval '30 min',
              $3, $4, $4)
           returning id`,
          [merchantId, cid, pin, total]
        )
      ).rows[0].id;

    // Commande SOUS le minimum : ne consomme pas l'attribution.
    const smallOrder = await mkOrder(F1.id, 300, "TRF1");
    await client.query(
      "update public.orders set status='completed' where id=$1",
      [smallOrder]
    );
    let ref1 = (
      await client.query(
        "select * from customer_referrals where referee_customer_id = $1",
        [F1.id]
      )
    ).rows[0];
    assert(
      ref1.status === "pending",
      "B1 commande sous le minimum → attribution toujours pending",
      ref1.status
    );

    // Commande AU-DESSUS du minimum : qualifie et crédite.
    const bigOrder = await mkOrder(F1.id, 1000, "TRF2");
    await client.query(
      "update public.orders set status='completed' where id=$1",
      [bigOrder]
    );
    ref1 = (
      await client.query(
        "select * from customer_referrals where referee_customer_id = $1",
        [F1.id]
      )
    ).rows[0];
    assert(
      ref1.status === "rewarded" && ref1.credited_at !== null,
      "B2 attribution rewarded + credited_at posé",
      `${ref1.status} / ${ref1.credited_at}`
    );
    assert(
      ref1.qualifying_order_id === bigOrder,
      "B3 qualifying_order_id = la commande qualifiante",
      ref1.qualifying_order_id
    );

    const credits = (
      await client.query(
        `select customer_id, amount_da, type, source from customer_wallet_entries
          where referral_id = $1 order by amount_da`,
        [ref1.id]
      )
    ).rows;
    assert(
      credits.length === 2 &&
        credits.every(
          (c) => c.type === "referral_credit" && c.source === "topup"
        ) &&
        credits.some((c) => c.customer_id === REF.id && c.amount_da === 300) &&
        credits.some((c) => c.customer_id === F1.id && c.amount_da === 300),
      "B4 exactement 2 crédits referral_credit (topup) de 300",
      JSON.stringify(credits)
    );

    const ledger = (
      await client.query(
        `select coalesce(sum(amount_da), 0)::int s, count(*)::int n
           from platform_ledger where type = 'referral_expense'`
      )
    ).rows[0];
    assert(
      ledger.n === 2 && ledger.s === -600,
      "B5 platform_ledger referral_expense = 2 lignes, SUM −600 (SUM global = 0)",
      JSON.stringify(ledger)
    );

    assert(
      (await bal(REF.id)) - refBal0 === 300 &&
        (await bal(F1.id)) - f1Bal0 === 300,
      "B6 soldes Coligo Pay +300 parrain et +300 filleul"
    );
    assert(
      (await cap30(REF.id)) === refCap0 && (await cap30(F1.id)) === f1Cap0,
      "B7 plafond recharge 30 j (0241) INSENSIBLE au referral_credit"
    );

    // Idempotence : double crédit impossible (index unique referral+customer).
    let dupRejected = false;
    try {
      await client.query("SAVEPOINT dup");
      await client.query(
        `insert into customer_wallet_entries
           (customer_id, type, source, amount_da, referral_id)
         values ($1, 'referral_credit', 'topup', 300, $2)`,
        [REF.id, ref1.id]
      );
    } catch {
      dupRejected = true;
      await client.query("ROLLBACK TO SAVEPOINT dup");
    }
    const nCredits = (
      await client.query(
        "select count(*)::int n from customer_wallet_entries where referral_id = $1",
        [ref1.id]
      )
    ).rows[0].n;
    assert(
      dupRejected && nCredits === 2,
      "B8 idempotence : double crédit rejeté par l'index unique",
      `rejected=${dupRejected} n=${nCredits}`
    );

    // Re-passage du trigger sur la même commande : aucun nouveau crédit.
    await client.query("update public.orders set status='ready' where id=$1", [
      bigOrder,
    ]);
    await client.query(
      "update public.orders set status='completed' where id=$1",
      [bigOrder]
    );
    const nCredits2 = (
      await client.query(
        "select count(*)::int n from customer_wallet_entries where referral_id = $1",
        [ref1.id]
      )
    ).rows[0].n;
    assert(nCredits2 === 2, "B9 re-complétion : zéro double crédit", nCredits2);

    // =========================================================================
    console.log("TEST C — même appareil → held, approbation admin → crédit");
    // =========================================================================
    // Même IP + UA pour le parrain et le filleul 2 → suspicion d'auto-parrainage.
    await client.query(
      `insert into user_device_log (user_id, role, ip, ua)
       values ($1, 'customer', '203.0.113.7', 'TestUA/1.0'),
              ($2, 'customer', '203.0.113.7', 'TestUA/1.0')
       on conflict do nothing`,
      [REF.user_id, F2.user_id]
    );

    r = (
      await client.query("select public.attach_referral($1, $2) j", [
        F2.id,
        code,
      ])
    ).rows[0].j;
    assert(
      r.ok === true,
      "C1 attribution filleul 2 acceptée",
      JSON.stringify(r)
    );

    const f2Order = await mkOrder(F2.id, 1000, "TRF3");
    await client.query(
      "update public.orders set status='completed' where id=$1",
      [f2Order]
    );
    let ref2 = (
      await client.query(
        "select * from customer_referrals where referee_customer_id = $1",
        [F2.id]
      )
    ).rows[0];
    assert(
      ref2.status === "held" &&
        (ref2.fraud_note ?? "").includes("appareil") &&
        ref2.credited_at === null,
      "C2 même appareil → held + note, ZÉRO crédit",
      `${ref2.status} / ${ref2.fraud_note}`
    );
    const f2Credits = (
      await client.query(
        "select count(*)::int n from customer_wallet_entries where referral_id = $1",
        [ref2.id]
      )
    ).rows[0].n;
    assert(f2Credits === 0, "C3 aucun crédit wallet tant que held", f2Credits);

    // Approbation par la VRAIE RPC admin (claims JWT simulées sur la session).
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ email: adminEmail, role: "authenticated" }),
    ]);
    r = (
      await client.query(
        "select public.admin_referral_decide($1, 'approve', 'test: famille OK') j",
        [ref2.id]
      )
    ).rows[0].j;
    assert(
      r.ok === true,
      "C4 admin_referral_decide(approve) ok",
      JSON.stringify(r)
    );

    ref2 = (
      await client.query("select * from customer_referrals where id = $1", [
        ref2.id,
      ])
    ).rows[0];
    const f2CreditsAfter = (
      await client.query(
        "select count(*)::int n from customer_wallet_entries where referral_id = $1",
        [ref2.id]
      )
    ).rows[0].n;
    assert(
      ref2.status === "rewarded" &&
        ref2.credited_at !== null &&
        f2CreditsAfter === 2,
      "C5 approbation → rewarded + 2 crédits (T2 réutilisé)",
      `${ref2.status} n=${f2CreditsAfter}`
    );

    // =========================================================================
    console.log("TEST D — révocation : contre-passation");
    // =========================================================================
    const refBalBeforeRevoke = await bal(REF.id);
    const f1BalBeforeRevoke = await bal(F1.id);
    r = (
      await client.query(
        "select public.admin_revoke_referral($1, 'test: fraude confirmée') j",
        [ref1.id]
      )
    ).rows[0].j;
    assert(r.ok === true, "D1 admin_revoke_referral ok", JSON.stringify(r));

    ref1 = (
      await client.query("select * from customer_referrals where id = $1", [
        ref1.id,
      ])
    ).rows[0];
    assert(ref1.status === "revoked", "D2 statut revoked", ref1.status);
    assert(
      refBalBeforeRevoke - (await bal(REF.id)) === 300 &&
        f1BalBeforeRevoke - (await bal(F1.id)) === 300,
      "D3 les deux soldes rendent 300"
    );
    const ledgerAfter = (
      await client.query(
        `select coalesce(sum(amount_da), 0)::int s
           from platform_ledger where type = 'referral_expense'`
      )
    ).rows[0].s;
    assert(
      ledgerAfter === -600,
      "D4 ledger net = −600 (−1200 crédits + 600 contre-passés)",
      ledgerAfter
    );

    // =========================================================================
    console.log("TEST E — expiration des attributions pending");
    // =========================================================================
    r = (
      await client.query("select public.attach_referral($1, $2) j", [
        F3.id,
        code,
      ])
    ).rows[0].j;
    assert(
      r.ok === true,
      "E1 attribution filleul 3 acceptée",
      JSON.stringify(r)
    );
    await client.query(
      `update customer_referrals set expires_at = now() - interval '1 day'
        where referee_customer_id = $1`,
      [F3.id]
    );
    const expired = (
      await client.query("select public.expire_referrals()::int n")
    ).rows[0].n;
    const ref3 = (
      await client.query(
        "select status from customer_referrals where referee_customer_id = $1",
        [F3.id]
      )
    ).rows[0];
    assert(
      expired >= 1 && ref3.status === "expired",
      "E2 expire_referrals() → expired",
      `n=${expired} status=${ref3.status}`
    );

    // =========================================================================
    console.log("TEST F — intégrité : zéro invariant parrainage violé");
    // =========================================================================
    const viol = (
      await client.query(
        "select code, cnt, detail from public.integrity_violations() where code like 'referral%'"
      )
    ).rows;
    assert(
      viol.length === 0,
      "F1 integrity_violations() : aucun invariant parrainage",
      JSON.stringify(viol)
    );
  } finally {
    await client.query("ROLLBACK");
  }
  await client.end();

  // ===========================================================================
  // Phase ANON — chaque RPC testée AVEC LA CLÉ ANON (règle du repo).
  // ===========================================================================
  console.log("TEST G — accès ANON aux RPC");
  loadEnvLocal();
  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );

  {
    const { data, error } = await anon.rpc("referral_code_valid", {
      p_code: "ZZZZZZZ2",
    });
    assert(
      !error && data && data.valid === false,
      "G1 referral_code_valid appelable en anon (valid:false)",
      error?.message ?? JSON.stringify(data)
    );
  }
  for (const [fn, args] of [
    ["my_referral_overview", {}],
    ["my_referral_code", {}],
    [
      "attach_referral",
      {
        p_referee_customer_id: "00000000-0000-0000-0000-000000000000",
        p_code: "X",
      },
    ],
    ["admin_referral_list", {}],
    ["admin_referral_stats", {}],
    [
      "admin_referral_decide",
      { p_id: "00000000-0000-0000-0000-000000000000", p_action: "approve" },
    ],
    ["admin_revoke_referral", { p_id: "00000000-0000-0000-0000-000000000000" }],
    [
      "admin_update_referral_settings",
      {
        p_enabled: true,
        p_reward_referrer_da: 1,
        p_reward_referee_da: 1,
        p_min_order_da: 1,
        p_max_referrals_month: 1,
        p_attribution_expiry_days: 1,
      },
    ],
    ["expire_referrals", {}],
  ]) {
    const { error } = await anon.rpc(fn, args);
    assert(!!error, `G2 ${fn} REFUSÉE en anon`, "aurait dû être refusée");
  }

  console.log(
    failures === 0
      ? "\n✅ Tous les tests parrainage passent."
      : `\n❌ ${failures} échec(s).`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
