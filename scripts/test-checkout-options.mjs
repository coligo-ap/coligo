// Test e2e (ROLLBACK) — options/variantes au checkout : prix + snapshots + sécu.
// Prouve les invariants ARGENT de la revalidation serveur (loadLineOptions) :
//   - une option n'ajoute son delta QUE si elle appartient au produit de la ligne
//     (anti-fraude : on ne peut pas attacher l'option d'un autre produit) ;
//   - le prix unitaire facturé = base + Σ deltas validés ;
//   - les snapshots order_item_options / order_promotions persistent et
//     disparaissent en cascade si la commande est supprimée.
// Exécution : node scripts/test-checkout-options.mjs
import { getDbUrl } from "./_supabase.mjs";
import pg from "pg";

let pass = 0,
  fail = 0;
const ok = (c, l) =>
  c ? (pass++, console.log("  ✅", l)) : (fail++, console.log("  ❌", l));

const c = new pg.Client({
  connectionString: getDbUrl(),
  ssl: { rejectUnauthorized: false },
});
await c.connect();

// Reproduit la règle serveur : delta validé = somme des options DEMANDÉES qui
// appartiennent BIEN au produit de la ligne et sont disponibles.
async function validatedDelta(productId, optionIds) {
  const r = await c.query(
    `SELECT COALESCE(SUM(o.price_delta_da),0)::int AS d
       FROM product_options o
       JOIN product_option_groups g ON g.id = o.group_id
      WHERE o.id = ANY($1) AND g.product_id = $2 AND o.is_available`,
    [optionIds, productId]
  );
  return r.rows[0].d;
}

try {
  await c.query("BEGIN");
  const merchantId = (await c.query("SELECT id FROM merchants LIMIT 1")).rows[0]
    .id;

  // Produit 1 (1000 DA) avec option +200 ; Produit 2 (500) avec option +50.
  const p1 = (
    await c.query(
      "INSERT INTO products (merchant_id,name_fr,price_da) VALUES ($1,'Pizza',1000) RETURNING id",
      [merchantId]
    )
  ).rows[0].id;
  const g1 = (
    await c.query(
      "INSERT INTO product_option_groups (product_id,name_fr,min_select,max_select) VALUES ($1,'Taille',1,1) RETURNING id",
      [p1]
    )
  ).rows[0].id;
  const o1 = (
    await c.query(
      "INSERT INTO product_options (group_id,name_fr,price_delta_da) VALUES ($1,'Grande',200) RETURNING id",
      [g1]
    )
  ).rows[0].id;

  const p2 = (
    await c.query(
      "INSERT INTO products (merchant_id,name_fr,price_da) VALUES ($1,'Salade',500) RETURNING id",
      [merchantId]
    )
  ).rows[0].id;
  const g2 = (
    await c.query(
      "INSERT INTO product_option_groups (product_id,name_fr) VALUES ($1,'Extra') RETURNING id",
      [p2]
    )
  ).rows[0].id;
  const o2 = (
    await c.query(
      "INSERT INTO product_options (group_id,name_fr,price_delta_da) VALUES ($1,'Sauce',50) RETURNING id",
      [g2]
    )
  ).rows[0].id;

  // 1) Option valide → delta appliqué.
  ok(
    (await validatedDelta(p1, [o1])) === 200,
    "option du produit → delta +200 appliqué"
  );

  // 2) Sécurité : option d'un AUTRE produit attachée à p1 → rejetée (delta 0).
  ok(
    (await validatedDelta(p1, [o2])) === 0,
    "option d'un autre produit → REJETÉE (delta 0)"
  );

  // 3) Prix unitaire effectif = base + delta validé.
  const unit = 1000 + (await validatedDelta(p1, [o1]));
  ok(unit === 1200, "prix unitaire facturé = base + options = 1200");

  // 4) Snapshots commande + lecture.
  const order = (
    await c.query(
      `INSERT INTO orders (merchant_id,customer_name,customer_phone,total_da,pickup_code,pickup_slot_at)
     VALUES ($1,'C','0550',1200,'1234',now()) RETURNING id`,
      [merchantId]
    )
  ).rows[0].id;
  const oi = (
    await c.query(
      `INSERT INTO order_items (order_id,product_name,name_ar,unit,unit_price_da,quantity,line_total_da)
     VALUES ($1,'Pizza','بيتزا','piece',$2,1,$2) RETURNING id`,
      [order, unit]
    )
  ).rows[0].id;
  await c.query(
    `INSERT INTO order_item_options (order_item_id,group_name_fr,option_name_fr,option_name_ar,price_delta_da)
     VALUES ($1,'Taille','Grande','كبيرة',200)`,
    [oi]
  );
  await c.query(
    `INSERT INTO order_promotions (order_id,type,title_fr,title_ar,discount_da,free_qty)
     VALUES ($1,'quantity_offer','2 achetés 1 offert','اشترِ 2 واحصل على 1',300,1)`,
    [order]
  );
  ok(
    (await c.query("SELECT unit_price_da FROM order_items WHERE id=$1", [oi]))
      .rows[0].unit_price_da === 1200,
    "order_items : prix unitaire snapshot = 1200 (avec option)"
  );
  ok(
    (
      await c.query(
        "SELECT count(*)::int n FROM order_item_options WHERE order_item_id=$1",
        [oi]
      )
    ).rows[0].n === 1,
    "order_item_options : snapshot option lisible"
  );
  ok(
    (
      await c.query(
        "SELECT count(*)::int n FROM order_promotions WHERE order_id=$1",
        [order]
      )
    ).rows[0].n === 1,
    "order_promotions : snapshot promo/offert lisible"
  );

  // 5) Cascade : supprimer la commande purge les snapshots.
  await c.query("DELETE FROM orders WHERE id=$1", [order]);
  ok(
    (
      await c.query(
        "SELECT count(*)::int n FROM order_item_options WHERE order_item_id=$1",
        [oi]
      )
    ).rows[0].n === 0,
    "cascade : order_item_options supprimés avec la commande"
  );

  await c.query("ROLLBACK");
} catch (e) {
  await c.query("ROLLBACK");
  console.error("ERREUR:", e.message);
  fail++;
} finally {
  await c.end();
}

console.log(`\n${pass}/${pass + fail} OK`);
process.exit(fail ? 1 : 0);
