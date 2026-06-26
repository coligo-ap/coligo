// Test e2e (transaction ROLLBACK) : opérations catalogue commerçant + preuve
// que les ventes/finances ne sont JAMAIS impactées par une modif/suppression.
//   - modifier l'unité (pièce → kg)
//   - modifier la catégorie d'un produit existant
//   - archiver un produit (soft-delete) → conservé, invisible, ventes intactes
//   - supprimer une catégorie → produits dé-catégorisés (SET NULL), pas supprimés
//   - même un HARD DELETE produit ne casse pas order_items (aucune FK)
// Exécution : node scripts/test-catalog-traceability.mjs
import { getDbUrl } from "./_supabase.mjs";
import pg from "pg";

let pass = 0,
  fail = 0;
function ok(cond, label) {
  if (cond) {
    pass++;
    console.log("  ✅", label);
  } else {
    fail++;
    console.log("  ❌", label);
  }
}

const c = new pg.Client({
  connectionString: getDbUrl(),
  ssl: { rejectUnauthorized: false },
});
await c.connect();
try {
  await c.query("BEGIN");

  const { rows: mrows } = await c.query("SELECT id FROM merchants LIMIT 1");
  const merchantId = mrows[0].id;

  const cat1 = (
    await c.query(
      "INSERT INTO categories (merchant_id, title) VALUES ($1,'TEST C1') RETURNING id",
      [merchantId]
    )
  ).rows[0].id;
  const cat2 = (
    await c.query(
      "INSERT INTO categories (merchant_id, title) VALUES ($1,'TEST C2') RETURNING id",
      [merchantId]
    )
  ).rows[0].id;

  const prod = (
    await c.query(
      `INSERT INTO products (merchant_id, name_fr, price_da, unit, category_id, image_url)
       VALUES ($1,'TEST Couscous',300,'piece',$2,'https://x/object/public/products/m/u.jpg')
       RETURNING id`,
      [merchantId, cat1]
    )
  ).rows[0].id;

  // 1) Modifier l'unité pièce → kg
  await c.query("UPDATE products SET unit='kg' WHERE id=$1", [prod]);
  ok(
    (await c.query("SELECT unit FROM products WHERE id=$1", [prod])).rows[0]
      .unit === "kg",
    "modifier l'unité → kg"
  );

  // 2) Modifier la catégorie d'un produit existant
  await c.query("UPDATE products SET category_id=$2 WHERE id=$1", [prod, cat2]);
  ok(
    (await c.query("SELECT category_id FROM products WHERE id=$1", [prod]))
      .rows[0].category_id === cat2,
    "modifier la catégorie d'un produit"
  );

  // 3) Vente : commande + ligne snapshot 3000 DA sur ce produit
  const order = (
    await c.query(
      `INSERT INTO orders (merchant_id, customer_name, customer_phone, total_da, pickup_code, pickup_slot_at)
       VALUES ($1,'Test Client','0550000000',3000,'1234', now()) RETURNING id`,
      [merchantId]
    )
  ).rows[0].id;
  await c.query(
    `INSERT INTO order_items (order_id, product_name, unit_price_da, quantity, line_total_da, unit)
     VALUES ($1,'TEST Couscous',1000,3,3000,'kg')`,
    [order]
  );
  const revenue = async () =>
    Number(
      (
        await c.query(
          "SELECT COALESCE(SUM(line_total_da),0) s FROM order_items WHERE order_id=$1",
          [order]
        )
      ).rows[0].s
    );
  ok((await revenue()) === 3000, "vente enregistrée = 3000 DA");

  // 3-bis) Produit lié à une PROMOTION ACTIVE + une COMMANDE EN COURS.
  const promo = (
    await c.query(
      `INSERT INTO promotions (merchant_id, type, title_fr, status)
       VALUES ($1,'product_discount','TEST Promo','active') RETURNING id`,
      [merchantId]
    )
  ).rows[0].id;
  await c.query(
    "INSERT INTO promotion_products (promotion_id, product_id) VALUES ($1,$2)",
    [promo, prod]
  );
  const openOrder = (
    await c.query(
      `INSERT INTO orders (merchant_id, customer_name, customer_phone, total_da, pickup_code, pickup_slot_at, status)
       VALUES ($1,'En cours','0551',1000,'9999', now(), 'preparing') RETURNING id`,
      [merchantId]
    )
  ).rows[0].id;
  await c.query(
    `INSERT INTO order_items (order_id, product_name, unit_price_da, quantity, line_total_da)
     VALUES ($1,'TEST Couscous',1000,1,1000)`,
    [openOrder]
  );

  // 4) Archiver le produit (soft-delete)
  await c.query(
    "UPDATE products SET archived_at=now(), is_available=false WHERE id=$1",
    [prod]
  );
  ok(
    (await c.query("SELECT archived_at FROM products WHERE id=$1", [prod]))
      .rows[0].archived_at != null,
    "produit archivé (conservé en base)"
  );
  ok((await revenue()) === 3000, "APRÈS archivage : vente toujours 3000 DA");
  ok(
    (
      await c.query(
        "SELECT 1 FROM products WHERE id=$1 AND archived_at IS NULL",
        [prod]
      )
    ).rowCount === 0,
    "produit archivé INVISIBLE au catalogue (filtre archived_at IS NULL)"
  );
  // Promotion active : le lien produit survit (archivage = UPDATE, pas DELETE).
  ok(
    (
      await c.query(
        "SELECT 1 FROM promotion_products WHERE promotion_id=$1 AND product_id=$2",
        [promo, prod]
      )
    ).rowCount === 1,
    "promotion active : lien produit INTACT après archivage (aucune cascade)"
  );
  // Commande EN COURS (en préparation) : totaux & lignes inchangés.
  ok(
    Number(
      (await c.query("SELECT total_da FROM orders WHERE id=$1", [openOrder]))
        .rows[0].total_da
    ) === 1000,
    "commande EN COURS : total inchangé après archivage du produit"
  );
  ok(
    Number(
      (
        await c.query(
          "SELECT COALESCE(SUM(line_total_da),0) s FROM order_items WHERE order_id=$1",
          [openOrder]
        )
      ).rows[0].s
    ) === 1000,
    "commande EN COURS : ligne produit intacte après archivage"
  );

  // 5) Supprimer une catégorie → produit dé-catégorisé (SET NULL), pas supprimé
  const prod2 = (
    await c.query(
      `INSERT INTO products (merchant_id, name_fr, price_da, category_id)
       VALUES ($1,'TEST P2',100,$2) RETURNING id`,
      [merchantId, cat1]
    )
  ).rows[0].id;
  await c.query("DELETE FROM categories WHERE id=$1", [cat1]);
  ok(
    (await c.query("SELECT category_id FROM products WHERE id=$1", [prod2]))
      .rows[0].category_id === null,
    "suppression catégorie → produit dé-catégorisé (SET NULL), conservé"
  );

  // 6) Même un HARD DELETE produit ne casse pas order_items (aucune FK)
  await c.query("DELETE FROM products WHERE id=$1", [prod]);
  ok(
    (await revenue()) === 3000,
    "APRÈS hard delete produit : order_items intact (3000 DA)"
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
