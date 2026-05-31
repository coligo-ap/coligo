#!/usr/bin/env node
/**
 * Seed de TEST (prod) :
 *  - ajoute ~17 produits à « Superette el sar » (thefast.contact@gmail.com)
 *  - crée 3 commerçants supplémentaires (Béjaïa) avec ~6 produits chacun
 *  - crée 1 commande Express + 5 commandes Tournée pour la cliente Lina
 *    (qawaexpress@gmail.com) chez Superette el sar (créneau du jour)
 *
 * Idempotent côté commerçants (skip si le slug existe) ; les produits/commandes
 * sont ajoutés à chaque exécution → lancer UNE fois.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { randomBytes, randomInt } from "node:crypto";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
function loadEnv() {
  let content;
  try {
    content = readFileSync(join(ROOT, ".env.local"), "utf8");
  } catch {
    return;
  }
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let v = m[2];
    if (
      (v.startsWith('"') && v.endsWith('"')) ||
      (v.startsWith("'") && v.endsWith("'"))
    )
      v = v.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = v;
  }
}
loadEnv();

const { getDbUrl } = await import("./_supabase.mjs");
const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
const supa = createClient(url, key, { auth: { persistSession: false } });
const c = new pg.Client({ connectionString: getDbUrl() });
await c.connect();

const SUPERETTE = "9192b8e4-31d3-4490-8c9e-0826cc2cdcd2";
const LINA_CUSTOMER = "c2debd28-082a-47f4-b21b-5364d7e6e470";
const LINA_NAME = "Lina Abbasi";
const LINA_PHONE = "+213772750559";
const TODAY = "2026-05-30";
const code6 = () => String(randomInt(100000, 999999));
const hex12 = () => randomBytes(6).toString("hex");

async function ensureAuthUser(email) {
  const { data, error } = await supa.auth.admin.createUser({
    email,
    password: email, // mdp = email (comptes de test)
    email_confirm: true,
  });
  if (!error) return data.user.id;
  const res = await fetch(
    `${url}/auth/v1/admin/users?email=${encodeURIComponent(email)}`,
    { headers: { apikey: key, Authorization: `Bearer ${key}` } }
  );
  const json = await res.json();
  const u = Array.isArray(json.users) ? json.users[0] : json;
  return u.id;
}

async function addProducts(merchantId, items) {
  let pos = 0;
  for (const p of items) {
    await c.query(
      `insert into products (merchant_id, name_fr, price_da, category, unit, is_available, position)
       values ($1,$2,$3,$4,'piece',true,$5)`,
      [merchantId, p.n, p.p, p.c, pos++]
    );
  }
  console.log(`  + ${items.length} produits`);
}

// ---------------------------------------------------------------------------
// 1) Produits pour Superette el sar
// ---------------------------------------------------------------------------
console.log("Superette el sar — produits :");
await addProducts(SUPERETTE, [
  { n: "Lait UHT 1L", p: 120, c: "Produits laitiers" },
  { n: "Yaourt nature x4", p: 90, c: "Produits laitiers" },
  { n: "Fromage portions x8", p: 220, c: "Produits laitiers" },
  { n: "Beurre 250g", p: 180, c: "Produits laitiers" },
  { n: "Eau minérale 1.5L", p: 40, c: "Boissons" },
  { n: "Soda cola 1L", p: 110, c: "Boissons" },
  { n: "Jus d'orange 1L", p: 150, c: "Boissons" },
  { n: "Café moulu 250g", p: 320, c: "Épicerie" },
  { n: "Sucre 1kg", p: 130, c: "Épicerie" },
  { n: "Huile de table 1L", p: 290, c: "Épicerie" },
  { n: "Pâtes spaghetti 500g", p: 90, c: "Épicerie" },
  { n: "Riz 1kg", p: 160, c: "Épicerie" },
  { n: "Tomates 1kg", p: 120, c: "Fruits & Légumes" },
  { n: "Pommes de terre 1kg", p: 80, c: "Fruits & Légumes" },
  { n: "Bananes 1kg", p: 250, c: "Fruits & Légumes" },
  { n: "Chips 150g", p: 100, c: "Snacks" },
  { n: "Chocolat tablette", p: 140, c: "Snacks" },
]);

// ---------------------------------------------------------------------------
// 2) Commerçants supplémentaires (Béjaïa)
// ---------------------------------------------------------------------------
const NEW_MERCHANTS = [
  {
    email: "seed.boulangerie.bejaia@coligo.local",
    name: "Boulangerie El Baraka",
    slug: "seed-boulangerie-el-baraka",
    category: "Boulangerie",
    commune: "Béjaïa",
    lat: 36.7558,
    lng: 5.07,
    products: [
      { n: "Baguette", p: 15, c: "Pains" },
      { n: "Pain de campagne", p: 40, c: "Pains" },
      { n: "Croissant", p: 35, c: "Viennoiserie" },
      { n: "Pain au chocolat", p: 40, c: "Viennoiserie" },
      { n: "Msemen", p: 25, c: "Traditionnel" },
      { n: "Gâteau sec (kg)", p: 800, c: "Pâtisserie" },
    ],
  },
  {
    email: "seed.resto.bejaia@coligo.local",
    name: "Restaurant Le Dauphin",
    slug: "seed-restaurant-le-dauphin",
    category: "Restauration",
    commune: "Béjaïa",
    lat: 36.7489,
    lng: 5.076,
    products: [
      { n: "Pizza Margherita", p: 600, c: "Pizzas" },
      { n: "Pizza 4 fromages", p: 800, c: "Pizzas" },
      { n: "Burger maison", p: 450, c: "Burgers" },
      { n: "Tacos poulet", p: 500, c: "Tacos" },
      { n: "Assiette grillade", p: 900, c: "Plats" },
      { n: "Salade César", p: 350, c: "Salades" },
    ],
  },
  {
    email: "seed.pharma.bejaia@coligo.local",
    name: "Parapharmacie Ibn Sina",
    slug: "seed-parapharmacie-ibn-sina",
    category: "Santé & Beauté",
    commune: "Béjaïa",
    lat: 36.7601,
    lng: 5.0588,
    products: [
      { n: "Gel hydroalcoolique 100ml", p: 250, c: "Hygiène" },
      { n: "Sérum physiologique x10", p: 200, c: "Soins" },
      { n: "Pansements assortis", p: 180, c: "Premiers soins" },
      { n: "Thermomètre digital", p: 900, c: "Matériel" },
      { n: "Crème hydratante", p: 650, c: "Soins" },
      { n: "Vitamine C effervescente", p: 300, c: "Compléments" },
    ],
  },
];

for (const m of NEW_MERCHANTS) {
  const exists = await c.query("select id from merchants where slug=$1", [
    m.slug,
  ]);
  if (exists.rows.length) {
    console.log(`Commerçant ${m.name} — déjà présent, skip`);
    continue;
  }
  const userId = await ensureAuthUser(m.email);
  const ins = await c.query(
    `insert into merchants
       (user_id, name, slug, shop_public_id, category, city, wilaya_code, commune,
        latitude, longitude, is_active, delivery_enabled, express_enabled, tours_enabled,
        accepts_cash, accepts_online, prep_time_min)
     values ($1,$2,$3,$4,$5,'Béjaïa','06',$6,$7,$8,true,true,true,true,true,true,12)
     returning id`,
    [userId, m.name, m.slug, hex12(), m.category, m.commune, m.lat, m.lng]
  );
  const mid = ins.rows[0].id;
  console.log(`Commerçant ${m.name} créé (${mid}) :`);
  await addProducts(mid, m.products);
}

// ---------------------------------------------------------------------------
// 3) Créneau du jour + commandes Express (1) et Tournée (5)
// ---------------------------------------------------------------------------
const slotIns = await c.query(
  `insert into delivery_slots (merchant_id, slot_date, start_time, end_time, max_orders, status)
   values ($1,$2,'09:00','20:00',10,'open') returning id`,
  [SUPERETTE, TODAY]
);
const slotId = slotIns.rows[0].id;
console.log(`Créneau tournée du ${TODAY} créé (${slotId})`);

async function createOrder({ mode, slot, payment, addr, lat, lng, items }) {
  const subtotal = items.reduce((s, it) => s + it.price * it.qty, 0);
  const deliveryFee = mode === "express" ? 200 : 150;
  const total = subtotal + deliveryFee;
  const o = await c.query(
    `insert into orders
       (merchant_id, customer_id, customer_name, customer_phone, status,
        subtotal_da, total_da, delivery_fee_da, pickup_code, pickup_slot_at,
        payment_method, payment_status, fulfillment_type, delivery_mode,
        delivery_slot_id, delivery_address_text, delivery_lat, delivery_lng, delivery_phone)
     values ($1,$2,$3,$4,'preparing',$5,$6,$7,$8, now(),
        $9,$10,'delivery',$11,$12,$13,$14,$15,$16)
     returning id`,
    [
      SUPERETTE,
      LINA_CUSTOMER,
      LINA_NAME,
      LINA_PHONE,
      subtotal,
      total,
      deliveryFee,
      code6(),
      payment,
      payment === "online" ? "paid" : "pending",
      mode,
      slot,
      addr,
      lat,
      lng,
      LINA_PHONE,
    ]
  );
  const oid = o.rows[0].id;
  for (const it of items) {
    await c.query(
      `insert into order_items (order_id, product_name, unit_price_da, quantity, line_total_da)
       values ($1,$2,$3,$4,$5)`,
      [oid, it.name, it.price, it.qty, it.price * it.qty]
    );
  }
  return oid;
}

// 1 Express
const expressId = await createOrder({
  mode: "express",
  slot: null,
  payment: "cash",
  addr: "Cité Tobbal, Béjaïa",
  lat: 36.7451,
  lng: 5.0671,
  items: [
    { name: "Lait UHT 1L", price: 120, qty: 2 },
    { name: "Eau minérale 1.5L", price: 40, qty: 3 },
    { name: "Chips 150g", price: 100, qty: 1 },
  ],
});
console.log(`Commande EXPRESS créée : ${expressId}`);

// 5 Tournée (adresses/positions variées autour de Béjaïa)
const TOUR = [
  {
    payment: "cash",
    addr: "Rue de la Liberté, Béjaïa",
    lat: 36.753,
    lng: 5.07,
    items: [
      { name: "Riz 1kg", price: 160, qty: 1 },
      { name: "Huile de table 1L", price: 290, qty: 1 },
    ],
  },
  {
    payment: "online",
    addr: "Quartier Sidi Ahmed, Béjaïa",
    lat: 36.7475,
    lng: 5.061,
    items: [
      { name: "Jus d'orange 1L", price: 150, qty: 2 },
      { name: "Chocolat tablette", price: 140, qty: 2 },
    ],
  },
  {
    payment: "cash",
    addr: "Cité Seghir, Béjaïa",
    lat: 36.761,
    lng: 5.0725,
    items: [
      { name: "Bananes 1kg", price: 250, qty: 1 },
      { name: "Yaourt nature x4", price: 90, qty: 2 },
    ],
  },
  {
    payment: "online",
    addr: "Boulevard Krim Belkacem, Béjaïa",
    lat: 36.744,
    lng: 5.0805,
    items: [
      { name: "Café moulu 250g", price: 320, qty: 1 },
      { name: "Sucre 1kg", price: 130, qty: 1 },
      { name: "Pain de campagne", price: 40, qty: 2 },
    ],
  },
  {
    payment: "cash",
    addr: "Aamriw, Béjaïa",
    lat: 36.7565,
    lng: 5.055,
    items: [
      { name: "Tomates 1kg", price: 120, qty: 2 },
      { name: "Pommes de terre 1kg", price: 80, qty: 2 },
      { name: "Eau minérale 1.5L", price: 40, qty: 4 },
    ],
  },
];
const tourIds = [];
for (const t of TOUR) {
  tourIds.push(await createOrder({ mode: "tour", slot: slotId, ...t }));
}
console.log(
  `Commandes TOURNÉE créées (${tourIds.length}) : ${tourIds.join(", ")}`
);

await c.end();
console.log("\\n✅ Seed terminé.");
