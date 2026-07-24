// =============================================================================
// Tests de non-régression — PANIER PARTAGÉ (mig 0405)
// =============================================================================
// Phase 1 (pg, UNE transaction ROLLBACK, claims JWT simulées) : logique des RPC
//   création capitaine → join invité (numérotation, re-join idempotent) →
//   ajouts (validation catalogue, fusion line_key, clamp qty) → set_qty
//   (uniquement SES lignes, 0 = suppression) → lecture by_token (prix résolus
//   du catalogue, JAMAIS de guest_token exposé) → fermeture invitations →
//   verrouillage → kill-switch flag.
// Phase 2 (clé ANON, live) : seules les RPC prévues répondent ; les helpers
//   internes et la création sont REFUSÉS.
// Usage : node scripts/test-shared-cart-anon.mjs
// =============================================================================

import { randomUUID } from "node:crypto";
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

  // ── Fixtures : capitaine + produit dispo + produit d'un AUTRE commerçant ──
  const captain = (
    await client.query(
      "select id, user_id from customers where user_id is not null order by created_at limit 1"
    )
  ).rows[0];
  const prod = (
    await client.query(
      `select p.id, p.merchant_id, p.price_da from products p
        join merchants m on m.id = p.merchant_id and m.is_active
       where p.is_available and p.archived_at is null and p.price_da > 0
       order by p.created_at limit 1`
    )
  ).rows[0];
  const otherProd = (
    await client.query(
      `select p.id from products p
        join merchants m on m.id = p.merchant_id and m.is_active
       where p.is_available and p.archived_at is null and p.merchant_id <> $1
       limit 1`,
      [prod?.merchant_id]
    )
  ).rows[0];
  if (!captain || !prod || !otherProd) {
    console.error(
      "Fixtures insuffisantes (client, 2 commerçants avec produits)."
    );
    process.exit(1);
  }

  await client.query("BEGIN");
  try {
    await client.query(
      "update feature_flags set status = 'active' where key = 'shared_cart'"
    );
    // Session CAPITAINE simulée (auth.uid() lit la claim `sub`).
    await client.query("select set_config('request.jwt.claims', $1, true)", [
      JSON.stringify({ sub: captain.user_id, role: "authenticated" }),
    ]);

    // =========================================================================
    console.log("TEST A — création capitaine + lignes initiales validées");
    // =========================================================================
    let r = (
      await client.query("select public.shared_cart_create($1, $2::jsonb) j", [
        prod.merchant_id,
        JSON.stringify([
          { product_id: prod.id, option_ids: [], quantity: 2 },
          { product_id: otherProd.id, option_ids: [], quantity: 1 }, // autre commerçant → ignorée
        ]),
      ])
    ).rows[0].j;
    assert(
      r.ok === true && r.token?.length === 8,
      "A1 création ok + token 8 car.",
      JSON.stringify(r)
    );
    const token = r.token;
    const cartId = r.cart_id;

    let items = (
      await client.query(
        "select member_id, product_id, quantity::float q from shared_cart_items where cart_id = $1",
        [cartId]
      )
    ).rows;
    assert(
      items.length === 1 && items[0].product_id === prod.id && items[0].q === 2,
      "A2 ligne d'un AUTRE commerçant ignorée, la bonne ligne posée (qty 2)",
      JSON.stringify(items)
    );

    // =========================================================================
    console.log("TEST B — invités : join, re-join, numérotation, plafond nom");
    // =========================================================================
    const guest1 = randomUUID();
    const guest2 = randomUUID();

    r = (
      await client.query("select public.shared_cart_join($1, $2, 'Maman') j", [
        token,
        guest1,
      ])
    ).rows[0].j;
    assert(
      r.ok === true &&
        r.member.member_number === 1 &&
        r.member.color_index === 1,
      "B1 invité 1 rejoint (n°1, couleur 1)",
      JSON.stringify(r)
    );
    const member1 = r.member.id;

    r = (
      await client.query("select public.shared_cart_join($1, $2, null) j", [
        token,
        guest1,
      ])
    ).rows[0].j;
    assert(
      r.ok === true && r.member.id === member1,
      "B2 re-join du même invité = même membre (idempotent)",
      JSON.stringify(r)
    );

    r = (
      await client.query("select public.shared_cart_join($1, $2, null) j", [
        token,
        guest2,
      ])
    ).rows[0].j;
    assert(
      r.ok === true &&
        r.member.member_number === 2 &&
        r.member.display_name === null,
      "B3 invité 2 sans prénom (n°2 → « Invité 2 » côté UI)",
      JSON.stringify(r)
    );

    // =========================================================================
    console.log("TEST C — ajouts : catalogue, fusion, clamp, propriété");
    // =========================================================================
    r = (
      await client.query(
        "select public.shared_cart_add_item($1, $2, $3, '{}'::uuid[], 1) j",
        [token, guest1, prod.id]
      )
    ).rows[0].j;
    assert(r.ok === true, "C1 ajout invité ok", JSON.stringify(r));

    r = (
      await client.query(
        "select public.shared_cart_add_item($1, $2, $3, '{}'::uuid[], 1) j",
        [token, guest1, prod.id]
      )
    ).rows[0].j;
    const g1line = (
      await client.query(
        "select id, quantity::float q from shared_cart_items where cart_id=$1 and member_id=$2",
        [cartId, member1]
      )
    ).rows;
    assert(
      r.ok === true && g1line.length === 1 && g1line[0].q === 2,
      "C2 même produit → FUSION sur la même ligne (qty 2)",
      JSON.stringify(g1line)
    );

    r = (
      await client.query(
        "select public.shared_cart_add_item($1, $2, $3, '{}'::uuid[], 1) j",
        [token, guest1, otherProd.id]
      )
    ).rows[0].j;
    assert(
      r.ok === false && r.reason === "product_unavailable",
      "C3 produit d'un autre commerçant REFUSÉ",
      JSON.stringify(r)
    );

    r = (
      await client.query(
        "select public.shared_cart_add_item($1, $2, $3, '{}'::uuid[], 50000) j",
        [token, guest2, prod.id]
      )
    ).rows[0].j;
    const g2line = (
      await client.query(
        `select i.id, i.quantity::float q from shared_cart_items i
          join shared_cart_members m on m.id = i.member_id
         where i.cart_id=$1 and m.guest_token=$2`,
        [cartId, guest2]
      )
    ).rows[0];
    assert(
      r.ok === true && g2line.q <= 999,
      "C4 quantité démesurée CLAMPÉE aux bornes produit",
      JSON.stringify(g2line)
    );

    // set_qty sur la ligne d'un AUTRE membre → refus.
    r = (
      await client.query("select public.shared_cart_set_qty($1, $2, $3, 5) j", [
        token,
        guest1,
        g2line.id,
      ])
    ).rows[0].j;
    assert(
      r.ok === false && r.reason === "not_yours",
      "C5 set_qty sur la ligne d'un autre invité REFUSÉ",
      JSON.stringify(r)
    );

    r = (
      await client.query("select public.shared_cart_set_qty($1, $2, $3, 0) j", [
        token,
        guest2,
        g2line.id,
      ])
    ).rows[0].j;
    const g2left = (
      await client.query(
        `select count(*)::int n from shared_cart_items i
          join shared_cart_members m on m.id = i.member_id
         where i.cart_id=$1 and m.guest_token=$2`,
        [cartId, guest2]
      )
    ).rows[0].n;
    assert(
      r.ok === true && g2left === 0,
      "C6 set_qty 0 = suppression de SA ligne",
      `n=${g2left}`
    );

    // =========================================================================
    console.log("TEST D — lecture by_token : prix du catalogue, zéro fuite");
    // =========================================================================
    const view = (
      await client.query("select public.shared_cart_by_token($1) j", [token])
    ).rows[0].j;
    assert(
      view?.cart?.status === "open",
      "D1 room lisible (open)",
      view?.cart?.status
    );
    assert(
      view.items.every((i) => i.unit_price_da === prod.price_da) &&
        view.total_da === Math.round(prod.price_da * 4),
      "D2 prix résolus du catalogue (2 capitaine + 2 invité = total ×4)",
      `total=${view.total_da} attendu=${prod.price_da * 4}`
    );
    assert(
      view.members.length === 3 &&
        view.members.every((m) => !("guest_token" in m)),
      "D3 3 membres, AUCUN guest_token exposé",
      JSON.stringify(view.members)
    );
    assert(
      typeof view.captain_name === "string" && view.captain_name.length > 0,
      "D4 prénom du capitaine présent",
      view.captain_name
    );

    // =========================================================================
    console.log("TEST E — fermeture invitations, verrouillage, kill-switch");
    // =========================================================================
    await client.query(
      "update shared_carts set invitations_closed = true where id = $1",
      [cartId]
    );
    r = (
      await client.query("select public.shared_cart_join($1, $2, null) j", [
        token,
        randomUUID(),
      ])
    ).rows[0].j;
    assert(
      r.ok === false && r.reason === "closed",
      "E1 invitations fermées → join refusé",
      JSON.stringify(r)
    );

    await client.query(
      "update shared_carts set status = 'locked' where id = $1",
      [cartId]
    );
    r = (
      await client.query(
        "select public.shared_cart_add_item($1, $2, $3, '{}'::uuid[], 1) j",
        [token, guest1, prod.id]
      )
    ).rows[0].j;
    assert(
      r.ok === false && r.reason === "cart_closed",
      "E2 panier verrouillé → ajout refusé",
      JSON.stringify(r)
    );

    await client.query(
      "update feature_flags set status = 'hidden' where key = 'shared_cart'"
    );
    const hiddenView = (
      await client.query("select public.shared_cart_by_token($1) j", [token])
    ).rows[0].j;
    assert(hiddenView === null, "E3 kill-switch → by_token NULL", hiddenView);

    r = (
      await client.query("select public.shared_cart_join($1, $2, null) j", [
        token,
        randomUUID(),
      ])
    ).rows[0].j;
    assert(
      r.ok === false && r.reason === "disabled",
      "E4 kill-switch → join disabled",
      JSON.stringify(r)
    );

    // Token bidon.
    const ghost = (
      await client.query("select public.shared_cart_by_token('deadbeef') j")
    ).rows[0].j;
    assert(ghost === null, "E5 token inconnu → NULL (zéro fuite)", ghost);
  } finally {
    await client.query("ROLLBACK");
  }
  await client.end();

  // ===========================================================================
  // Phase ANON (live) — droits d'exécution réels.
  // ===========================================================================
  console.log("TEST F — accès ANON aux RPC (clé anon, live)");
  loadEnvLocal();
  const anon = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  );

  {
    const { data, error } = await anon.rpc("shared_cart_by_token", {
      p_token: "deadbeef",
    });
    assert(
      !error && data === null,
      "F1 shared_cart_by_token appelable en anon (NULL)",
      error?.message
    );
  }
  {
    const { data, error } = await anon.rpc("shared_cart_join", {
      p_token: "deadbeef",
      p_guest_token: randomUUID(),
      p_display_name: null,
    });
    assert(
      !error && data?.ok === false,
      "F2 shared_cart_join appelable en anon (refus propre)",
      error?.message ?? JSON.stringify(data)
    );
  }
  for (const [fn, args] of [
    ["shared_cart_create", { p_merchant_id: randomUUID(), p_items: [] }],
    [
      "_shared_cart_add_validated",
      {
        p_cart_id: randomUUID(),
        p_member_id: randomUUID(),
        p_product_id: randomUUID(),
        p_option_ids: [],
        p_quantity: 1,
      },
    ],
    ["_shared_cart_actor", { p_cart_id: randomUUID(), p_guest_token: null }],
  ]) {
    const { error } = await anon.rpc(fn, args);
    assert(!!error, `F3 ${fn} REFUSÉE en anon`, "aurait dû être refusée");
  }

  console.log(
    failures === 0
      ? "\n✅ Tous les tests panier partagé passent."
      : `\n❌ ${failures} échec(s).`
  );
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
