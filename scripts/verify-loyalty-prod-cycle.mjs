// =============================================================================
// PHASE 5 — CYCLE RÉEL de bout en bout, COMMITTÉ en prod (env de test).
// =============================================================================
// Contrairement à test-loyalty.mjs (transaction ROLLBACK), ce script exécute le
// cycle complet du spec AVEC COMMIT, via les VRAIES RPC et les claims JWT de
// chaque rôle — les données créées restent visibles dans la console admin
// (journal des lots + PDF téléchargeable) et sur la landing publique /c/<code>.
//
//   1. flag `loyalty` → active (le temps du cycle)
//   2. programme du commerçant configuré (RPC commerçant)
//   3. lot RÉEL de 3 cartes (RPC admin) → visible console + PDF
//   4. crédit en caisse sur carte `printed` (activation + cashback + palier)
//   5. fiche caisse (resolve) + landing publique (peek anonyme)
//   6. liaison de la carte au client de test (transfert + bonus)
//   7. landing publique après liaison → AUCUNE donnée (règle propriétaire)
//   8. réduction en caisse via la carte liée (débite le compte client)
//   9. vue client my_loyalty_overview (carte-magasin présente)
//  10. flag `loyalty` → remis à HIDDEN (le lancement reste une décision owner)
//
// Usage : node scripts/verify-loyalty-prod-cycle.mjs
// Sortie : assertions + les URLs /c/<code> du lot (pour captures + tirage).
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
const opId = () => `p5-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

async function main() {
  await client.connect();
  const j = async (sql, params) => (await client.query(sql, params)).rows[0].j;
  const asClaims = (claims) =>
    client.query("select set_config('request.jwt.claims', $1, false)", [
      JSON.stringify(claims),
    ]);

  // ── Fixtures réelles ──────────────────────────────────────────────────────
  const mer = (
    await client.query(
      `select id, user_id, name from merchants
        where is_active and user_id is not null
          and coalesce(is_frozen, false) = false
        order by created_at limit 1`
    )
  ).rows[0];
  const cust = (
    await client.query(
      `select id, user_id, full_name from customers
        where user_id is not null order by created_at limit 1`
    )
  ).rows[0];
  const admin = (
    await client.query(
      `select email from platform_admins
        where is_active and (role = 'owner' or 'commercants' = any(domains))
        limit 1`
    )
  ).rows[0];
  if (!mer || !cust || !admin) {
    console.error("Fixtures insuffisantes (commerçant/client/admin).");
    process.exit(1);
  }
  console.log(
    `Commerçant : ${mer.name} · Client : ${cust.full_name} · Admin : ${admin.email}`
  );

  const flagBefore = (
    await client.query("select status from feature_flags where key = 'loyalty'")
  ).rows[0]?.status;

  try {
    // 1. Flag actif le temps du cycle.
    await client.query(
      "update feature_flags set status = 'active' where key = 'loyalty'"
    );

    // 2. Programme du commerçant (RPC COMMERÇANT — claims sub).
    await asClaims({ sub: mer.user_id, role: "authenticated" });
    let r = await j(
      "select public.merchant_update_loyalty_program(true, 5, 2000, 200, 90, 5000, 100) j"
    );
    assert(r.ok === true, "1. programme configuré (5 %, palier 2000→200)");

    // 3. Lot RÉEL de 3 cartes (RPC ADMIN — claims email).
    await asClaims({ email: admin.email, role: "authenticated" });
    r = await j(
      "select public.admin_loyalty_create_batch($1, 3, 'violet', 'Lot TEST Phase 5 — tirage d''essai') j",
      [mer.id]
    );
    assert(
      r.ok === true,
      "2. lot réel créé (console admin : journal + PDF)",
      JSON.stringify(r)
    );
    const cards = (
      await client.query(
        "select id, card_code, status from loyalty_cards where batch_id = $1 order by created_at",
        [r.batch_id]
      )
    ).rows;
    assert(
      cards.length === 3 && cards.every((c) => c.status === "printed"),
      "3. 3 cartes pré-enregistrées `printed`"
    );
    const CARD = cards[0];

    // 4. Crédit en caisse sur carte JAMAIS distribuée → activation.
    await asClaims({ sub: mer.user_id, role: "authenticated" });
    r = await j("select public.loyalty_credit($1, 2000, $2) j", [
      `https://coligo.app/c/${CARD.card_code}`,
      opId(),
    ]);
    assert(
      r.ok === true && r.activated === true && r.earned_da === 100,
      "4. 1er crédit en caisse : carte activée + 100 DA (+ palier)",
      JSON.stringify(r)
    );

    // 5. Fiche caisse + landing publique ANONYME.
    r = await j("select public.loyalty_resolve_scan($1) j", [CARD.card_code]);
    assert(
      r.ok === true && r.summary.balance_da === 300,
      "5. fiche caisse : 300 DA (100 cashback + bon 200)",
      JSON.stringify(r.summary)
    );
    await asClaims({ role: "anon" });
    r = await j("select public.loyalty_card_public_peek($1) j", [
      CARD.card_code,
    ]);
    assert(
      r.ok === true && r.total_da === 300 && (r.balances ?? []).length === 1,
      "6. landing publique (anonyme) : solde par magasin visible",
      JSON.stringify(r)
    );

    // 6. Liaison au client de test.
    await asClaims({ sub: cust.user_id, role: "authenticated" });
    r = await j("select public.loyalty_link_card($1) j", [CARD.card_code]);
    assert(
      r.ok === true && (r.moved ?? []).length === 1 && r.bonus_da === 100,
      "7. liaison : 300 DA transférés + bonus 100",
      JSON.stringify(r)
    );

    // 7. Landing APRÈS liaison : aucune donnée (règle propriétaire).
    await asClaims({ role: "anon" });
    r = await j("select public.loyalty_card_public_peek($1) j", [
      CARD.card_code,
    ]);
    assert(
      r.ok === true &&
        r.status === "linked" &&
        r.total_da === undefined &&
        r.balances === undefined,
      "8. landing après liaison : ni solde ni identité",
      JSON.stringify(r)
    );

    // 8. Réduction en caisse via la carte liée (alias du compte client).
    await asClaims({ sub: mer.user_id, role: "authenticated" });
    r = await j("select public.loyalty_redeem($1, $2, null, 50) j", [
      CARD.card_code,
      opId(),
    ]);
    assert(
      r.ok === true && r.deducted_da === 50,
      "9. réduction 50 DA (déduction atomique sur le compte client)",
      JSON.stringify(r)
    );

    // 9. Vue client.
    await asClaims({ sub: cust.user_id, role: "authenticated" });
    r = await j("select public.my_loyalty_overview() j");
    const acc = (r.accounts ?? []).find((a) => a.merchant_id === mer.id);
    assert(
      !!acc && acc.summary.balance_da === 350,
      "10. section client : carte-magasin (300+100−50 = 350 DA)",
      JSON.stringify(acc?.summary)
    );

    // 10. Intégrité globale après le cycle COMMITTÉ.
    const viol = (
      await client.query(
        "select code from public.integrity_violations() where code like 'loyalty%'"
      )
    ).rows;
    assert(
      viol.length === 0,
      "11. integrity_violations() : zéro invariant",
      JSON.stringify(viol)
    );

    console.log("\nURLs publiques du lot (captures + tirage d'essai) :");
    for (const c of cards) {
      console.log(`  https://coligo.app/c/${c.card_code}`);
    }
  } finally {
    // Le LANCEMENT reste une décision du propriétaire : flag remis tel quel.
    await client.query(
      "update feature_flags set status = $1 where key = 'loyalty'",
      [flagBefore ?? "hidden"]
    );
    console.log(`\nFlag loyalty remis à « ${flagBefore ?? "hidden"} ».`);
    await client.end();
  }

  console.log(
    failures === 0
      ? "\n✅ Cycle réel de bout en bout : tout est vert."
      : `\n❌ ${failures} échec(s).`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
