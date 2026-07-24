// =============================================================================
// Tests de non-régression — ROUE COLIGO (mig 0407)
// =============================================================================
// Transaction ROLLBACK sur la prod (claims JWT simulées) :
//   A. état initial (can_spin), tirage → un lot cohérent, spin enregistré ;
//   B. lot « voucher » → customer_vouchers créé → Coligo Pay crédité (trigger
//      0293) + ledger équilibré ; lot « nothing » → zéro écriture ;
//   C. UN par jour : 2ᵉ spin refusé (already_spun) ;
//   D. série : spin d'hier simulé → streak 2 ; bonus au jour cible (×2) ;
//   E. kill-switch (flag/settings) → disabled ;
//   F. anon : wheel_spin / my_wheel_state / admin_wheel_stats REFUSÉES.
// Usage : node scripts/test-wheel.mjs
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

async function main() {
  await client.connect();
  const cust = (
    await client.query(
      "select id, user_id from customers where user_id is not null order by created_at limit 1"
    )
  ).rows[0];
  if (!cust) {
    console.error("Aucun client de test.");
    process.exit(1);
  }

  await client.query("BEGIN");
  try {
    await client.query(
      "update feature_flags set status='active' where key='wheel'"
    );
    await client.query(
      "update wheel_settings set enabled=true, streak_target=7, streak_multiplier=2 where id=1"
    );
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: cust.user_id, role: "authenticated" }),
    ]);

    // =========================================================================
    console.log("TEST A — état + tirage serveur");
    // =========================================================================
    let state = (await client.query("select public.my_wheel_state() j")).rows[0]
      .j;
    assert(
      state.enabled === true && state.can_spin === true && state.streak === 0,
      "A1 état initial : jouable, série 0",
      JSON.stringify(state)
    );

    const balBefore = (
      await client.query("select public.customer_topup_balance($1)::int b", [
        cust.id,
      ])
    ).rows[0].b;

    const spin = (await client.query("select public.wheel_spin() j")).rows[0].j;
    assert(
      spin.ok === true &&
        ["voucher", "nothing"].includes(spin.kind) &&
        spin.streak === 1,
      "A2 tirage ok (lot du catalogue, série 1)",
      JSON.stringify(spin)
    );
    const row = (
      await client.query(
        "select amount_da, voucher_id from wheel_spins where customer_id=$1 and day=current_date",
        [cust.id]
      )
    ).rows[0];
    assert(!!row, "A3 tour enregistré (unique customer+jour)");

    // =========================================================================
    console.log("TEST B — argent : voucher crédité OU rien du tout");
    // =========================================================================
    const balAfter = (
      await client.query("select public.customer_topup_balance($1)::int b", [
        cust.id,
      ])
    ).rows[0].b;
    if (spin.kind === "voucher") {
      assert(
        row.voucher_id !== null && balAfter - balBefore === spin.amount_da,
        `B1 lot ${spin.amount_da} DA crédité sur Coligo Pay (trigger 0293)`,
        `Δ=${balAfter - balBefore}`
      );
      const ledger = (
        await client.query(
          `select coalesce(sum(amount_da),0)::int s from platform_ledger
            where type='voucher_expense' and created_at > now() - interval '1 minute'`
        )
      ).rows[0].s;
      assert(
        ledger === -spin.amount_da,
        "B2 ledger voucher_expense équilibré (SUM=0)",
        ledger
      );
    } else {
      assert(
        row.voucher_id === null && balAfter === balBefore,
        "B1 « retente demain » : zéro crédit, zéro écriture",
        `Δ=${balAfter - balBefore}`
      );
    }

    // =========================================================================
    console.log("TEST C — un seul tour par jour");
    // =========================================================================
    const again = (await client.query("select public.wheel_spin() j")).rows[0]
      .j;
    assert(
      again.ok === false && again.reason === "already_spun",
      "C1 2ᵉ tirage du jour REFUSÉ",
      JSON.stringify(again)
    );
    state = (await client.query("select public.my_wheel_state() j")).rows[0].j;
    assert(
      state.can_spin === false && state.streak === 1,
      "C2 état : plus jouable aujourd'hui, série 1",
      JSON.stringify(state)
    );

    // =========================================================================
    console.log("TEST D — série + bonus au jour cible");
    // =========================================================================
    // Simule 6 jours consécutifs AVANT aujourd'hui → le tour du jour = 7ᵉ.
    await client.query("delete from wheel_spins where customer_id=$1", [
      cust.id,
    ]);
    for (let d = 1; d <= 6; d++) {
      await client.query(
        `insert into wheel_spins (customer_id, day, amount_da, streak)
         values ($1, current_date - $2::int, 0, $3)`,
        [cust.id, d, 7 - d]
      );
    }
    // Force un lot voucher certain : ne laisse actif qu'un lot 100 DA.
    await client.query(
      "update wheel_prizes set active = (amount_da = 100 and kind='voucher')"
    );
    const spin7 = (await client.query("select public.wheel_spin() j")).rows[0]
      .j;
    assert(
      spin7.ok === true &&
        spin7.streak === 7 &&
        spin7.bonus === true &&
        spin7.amount_da === 200,
      "D1 7ᵉ jour consécutif : bonus ×2 appliqué (100 → 200 DA)",
      JSON.stringify(spin7)
    );

    // =========================================================================
    console.log("TEST E — kill-switch");
    // =========================================================================
    await client.query(
      "update feature_flags set status='hidden' where key='wheel'"
    );
    const off = (await client.query("select public.wheel_spin() j")).rows[0].j;
    assert(
      off.ok === false && off.reason === "disabled",
      "E1 flag caché → tirage refusé",
      JSON.stringify(off)
    );
  } finally {
    await client.query("ROLLBACK");
  }
  await client.end();

  // ===========================================================================
  console.log("TEST F — accès ANON");
  // ===========================================================================
  loadEnvLocal();
  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );
  for (const fn of ["wheel_spin", "my_wheel_state", "admin_wheel_stats"]) {
    const { error } = await anon.rpc(fn, {});
    assert(!!error, `F1 ${fn} REFUSÉE en anon`);
  }

  console.log(
    failures === 0
      ? "\n✅ Tous les tests Roue passent."
      : `\n❌ ${failures} échec(s).`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
