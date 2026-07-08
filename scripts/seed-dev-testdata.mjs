#!/usr/bin/env node
/**
 * SEED de l'environnement de DÉVELOPPEMENT (base Supabase gvdojuitcexemvkcaqfa).
 * NE TOUCHE JAMAIS LA PROD : url/clé/DB codées en dur sur le projet dev.
 *
 * Crée les comptes de test demandés + un marketplace réaliste pour travailler
 * à l'aise : ~24 commerçants sur 10 grandes wilayas (dont Akbou & Béjaïa), avec
 * photos de couverture (banque d'images mig 0348) et produits illustrés (photos
 * Unsplash vérifiées HTTP 200, repli sur la couverture de la catégorie), plus
 * quelques commandes de démonstration.
 *
 * Comptes (mot de passe = identifiant) :
 *   - Commerçant : thefast.contact@gmail.com  (patron du flagship « The Fast Market », Akbou)
 *   - Client     : qawaexpress@gmail.com
 *   - Livreur    : 003044618  (→ 003044618@drivers.coligo.local)
 *   - Chauffeur  : 003044618  (→ 003044618@chauffeurs.coligo.local)
 *   - Agent Pay  : 0603044618 (→ 0603044618@partners.coligo.local)
 *
 * Idempotent : comptes/commerçants réutilisés si déjà présents ; produits &
 * commandes ajoutés seulement si absents. Rejouable sans casse.
 *
 *   node scripts/seed-dev-testdata.mjs
 */
import { randomBytes, randomInt } from "node:crypto";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { getDbUrl } from "./_supabase.mjs";

// ── Cibles DEV (jamais la prod) ─────────────────────────────────────────────
// L'URL du projet dev est publique ; la clé service_role vit en env (jamais
// committée) : SUPABASE_DEV_SERVICE_ROLE_KEY dans .env.local.
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
for (const line of readFileSync(join(ROOT, ".env.local"), "utf8").split(
  /\r?\n/
)) {
  const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
  if (m && process.env[m[1]] === undefined)
    process.env[m[1]] = m[2].replace(/^["']|["']$/g, "");
}
const DEV_URL = "https://gvdojuitcexemvkcaqfa.supabase.co";
const DEV_SERVICE_ROLE = process.env.SUPABASE_DEV_SERVICE_ROLE_KEY;
if (!DEV_SERVICE_ROLE) {
  console.error("❌ SUPABASE_DEV_SERVICE_ROLE_KEY manquant dans .env.local.");
  process.exit(1);
}

const supa = createClient(DEV_URL, DEV_SERVICE_ROLE, {
  auth: { persistSession: false },
});
const c = new pg.Client({
  connectionString: getDbUrl("dev"),
  ssl: { rejectUnauthorized: false },
});
await c.connect();

const hex12 = () => randomBytes(6).toString("hex");
const code6 = () => String(randomInt(100000, 999999));

// ── Auth : crée l'utilisateur ou récupère son id (par email EXACT) ──────────
async function findUserByEmail(email) {
  // GoTrue admin ignore ?email= → on pagine et on filtre côté client.
  for (let page = 1; page <= 20; page++) {
    const { data, error } = await supa.auth.admin.listUsers({
      page,
      perPage: 200,
    });
    if (error) throw error;
    const hit = (data.users ?? []).find(
      (u) => (u.email ?? "").toLowerCase() === email.toLowerCase()
    );
    if (hit) return hit.id;
    if ((data.users ?? []).length < 200) break;
  }
  return null;
}
async function ensureAuthUser(email, password) {
  const { data, error } = await supa.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (!error) return data.user.id;
  const existing = await findUserByEmail(email);
  if (existing) {
    // On (ré)aligne le mot de passe des comptes de test.
    await supa.auth.admin.updateUserById(existing, { password });
    return existing;
  }
  throw new Error(`Impossible de créer/retrouver ${email} : ${error.message}`);
}

// ── Vérif d'URL d'image (cache) : repli si 404 ──────────────────────────────
const urlOk = new Map();
async function checkUrl(u) {
  if (!u) return false;
  if (urlOk.has(u)) return urlOk.get(u);
  let ok = false;
  try {
    const r = await fetch(u, { method: "HEAD" });
    ok = r.ok;
  } catch {
    ok = false;
  }
  urlOk.set(u, ok);
  return ok;
}

// ── Photos produits (Unsplash) par mot-clé ; repli = couverture catégorie ───
const PHOTO = {
  lait: "https://images.unsplash.com/photo-1550583724-b2692b85b150?w=800&q=80&auto=format",
  yaourt:
    "https://images.unsplash.com/photo-1488477181946-6428a0291777?w=800&q=80&auto=format",
  fromage:
    "https://images.unsplash.com/photo-1486297678162-eb2a19b0a32d?w=800&q=80&auto=format",
  beurre:
    "https://images.unsplash.com/photo-1589985270826-4b7bb135bc9d?w=800&q=80&auto=format",
  oeuf: "https://images.unsplash.com/photo-1518569656558-1f25e69d93d7?w=800&q=80&auto=format",
  eau: "https://images.unsplash.com/photo-1560023907-5f339617ea30?w=800&q=80&auto=format",
  soda: "https://images.unsplash.com/photo-1622483767028-3f66f32aef97?w=800&q=80&auto=format",
  jus: "https://images.unsplash.com/photo-1600271886742-f049cd451bba?w=800&q=80&auto=format",
  cafe: "https://images.unsplash.com/photo-1495474472287-4d71bcdd2085?w=800&q=80&auto=format",
  the: "https://images.unsplash.com/photo-1544787219-7f47ccb76574?w=800&q=80&auto=format",
  sucre:
    "https://images.unsplash.com/photo-1581441363689-1f3c3c414635?w=800&q=80&auto=format",
  huile:
    "https://images.unsplash.com/photo-1474979266404-7eaacbcd87c5?w=800&q=80&auto=format",
  pates:
    "https://images.unsplash.com/photo-1551462147-ff29053bfc14?w=800&q=80&auto=format",
  riz: "https://images.unsplash.com/photo-1586201375761-83865001e31c?w=800&q=80&auto=format",
  chips:
    "https://images.unsplash.com/photo-1566478989037-eec170784d0b?w=800&q=80&auto=format",
  chocolat:
    "https://images.unsplash.com/photo-1548907040-4baa42d10919?w=800&q=80&auto=format",
  baguette:
    "https://images.unsplash.com/photo-1549931319-a545dcf3bc73?w=800&q=80&auto=format",
  pain: "https://images.unsplash.com/photo-1509440159596-0249088772ff?w=800&q=80&auto=format",
  croissant:
    "https://images.unsplash.com/photo-1555507036-ab1f4038808a?w=800&q=80&auto=format",
  msemen:
    "https://images.unsplash.com/photo-1565299624946-b28f40a0ae38?w=800&q=80&auto=format",
  gateau:
    "https://images.unsplash.com/photo-1578985545062-69928b1d9587?w=800&q=80&auto=format",
  pizza:
    "https://images.unsplash.com/photo-1513104890138-7c749659a591?w=800&q=80&auto=format",
  burger:
    "https://images.unsplash.com/photo-1568901346375-23c9450c58cd?w=800&q=80&auto=format",
  tacos:
    "https://images.unsplash.com/photo-1565299585323-38d6b0865b47?w=800&q=80&auto=format",
  frites:
    "https://images.unsplash.com/photo-1573080496219-bb080dd4f877?w=800&q=80&auto=format",
  sandwich:
    "https://images.unsplash.com/photo-1553909489-cd47e0907980?w=800&q=80&auto=format",
  poulet:
    "https://images.unsplash.com/photo-1598103442097-8b74394b95c6?w=800&q=80&auto=format",
  viande:
    "https://images.unsplash.com/photo-1603048297172-c92544798d5a?w=800&q=80&auto=format",
  merguez:
    "https://images.unsplash.com/photo-1529692236671-f1f6cf9683ba?w=800&q=80&auto=format",
  couscous:
    "https://images.unsplash.com/photo-1585032226651-759b368d7246?w=800&q=80&auto=format",
  grillade:
    "https://images.unsplash.com/photo-1544025162-d76694265947?w=800&q=80&auto=format",
  salade:
    "https://images.unsplash.com/photo-1512621776951-a57141f2eefd?w=800&q=80&auto=format",
  tomate:
    "https://images.unsplash.com/photo-1546094096-0df4bcaaa337?w=800&q=80&auto=format",
  pomme_de_terre:
    "https://images.unsplash.com/photo-1518977676601-b53f82aba655?w=800&q=80&auto=format",
  banane:
    "https://images.unsplash.com/photo-1571771894821-ce9b6c11b08e?w=800&q=80&auto=format",
  orange:
    "https://images.unsplash.com/photo-1547514701-42782101795e?w=800&q=80&auto=format",
  pomme:
    "https://images.unsplash.com/photo-1568702846914-96b305d2aaeb?w=800&q=80&auto=format",
  glace:
    "https://images.unsplash.com/photo-1501443762994-82bd5dace89a?w=800&q=80&auto=format",
  gel: "https://images.unsplash.com/photo-1584362917165-526a968579e8?w=800&q=80&auto=format",
  creme:
    "https://images.unsplash.com/photo-1556228578-8c89e6adf883?w=800&q=80&auto=format",
  vitamine:
    "https://images.unsplash.com/photo-1550572017-edd951b55104?w=800&q=80&auto=format",
  cappuccino:
    "https://images.unsplash.com/photo-1572442388796-11668a67e53d?w=800&q=80&auto=format",
};
function photoFor(name) {
  const n = name.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
  const map = [
    ["cappuccino", "cappuccino"],
    ["lait", "lait"],
    ["yaourt", "yaourt"],
    ["fromage", "fromage"],
    ["beurre", "beurre"],
    ["oeuf", "oeuf"],
    ["eau", "eau"],
    ["cola", "soda"],
    ["soda", "soda"],
    ["jus", "jus"],
    ["cafe", "cafe"],
    ["the", "the"],
    ["sucre", "sucre"],
    ["huile", "huile"],
    ["pate", "pates"],
    ["spaghetti", "pates"],
    ["riz", "riz"],
    ["chips", "chips"],
    ["chocolat", "chocolat"],
    ["baguette", "baguette"],
    ["pain", "pain"],
    ["croissant", "croissant"],
    ["msemen", "msemen"],
    ["gateau", "gateau"],
    ["patisserie", "gateau"],
    ["pizza", "pizza"],
    ["burger", "burger"],
    ["tacos", "tacos"],
    ["frite", "frites"],
    ["sandwich", "sandwich"],
    ["poulet", "poulet"],
    ["viande", "viande"],
    ["boeuf", "viande"],
    ["merguez", "merguez"],
    ["couscous", "couscous"],
    ["grillade", "grillade"],
    ["salade", "salade"],
    ["tomate", "tomate"],
    ["pomme de terre", "pomme_de_terre"],
    ["banane", "banane"],
    ["orange", "orange"],
    ["pomme", "pomme"],
    ["glace", "glace"],
    ["sorbet", "glace"],
    ["gel", "gel"],
    ["creme", "creme"],
    ["vitamine", "vitamine"],
    ["serum", "gel"],
  ];
  for (const [kw, key] of map) if (n.includes(kw)) return PHOTO[key];
  return null;
}

// ── Couverture depuis la banque d'images (mig 0348), par catégorie ──────────
const coverCache = new Map();
async function coverFor(category) {
  if (coverCache.has(category)) return coverCache.get(category);
  const r = await c.query(
    `select url from merchant_image_bank
       where kind='cover' and active and (category=$1 or category is null)
       order by (category=$1) desc, position asc limit 1`,
    [category]
  );
  const url = r.rows[0]?.url ?? null;
  coverCache.set(category, url);
  return url;
}

const OPEN = {
  mon: [{ open: "08:00", close: "22:00" }],
  tue: [{ open: "08:00", close: "22:00" }],
  wed: [{ open: "08:00", close: "22:00" }],
  thu: [{ open: "08:00", close: "22:00" }],
  fri: [{ open: "08:00", close: "22:00" }],
  sat: [{ open: "08:00", close: "22:00" }],
  sun: [{ open: "09:00", close: "21:00" }],
};

// ── Modèles de produits par catégorie ───────────────────────────────────────
const T = {
  superette: [
    ["Lait UHT 1L", 120, "Produits laitiers"],
    ["Yaourt nature x4", 90, "Produits laitiers"],
    ["Fromage portions x8", 220, "Produits laitiers"],
    ["Beurre 250g", 180, "Produits laitiers"],
    ["Œufs x12", 260, "Produits laitiers"],
    ["Eau minérale 1.5L", 40, "Boissons"],
    ["Soda cola 1L", 110, "Boissons"],
    ["Jus d'orange 1L", 150, "Boissons"],
    ["Café moulu 250g", 320, "Épicerie"],
    ["Sucre 1kg", 130, "Épicerie"],
    ["Huile de table 1L", 290, "Épicerie"],
    ["Pâtes spaghetti 500g", 90, "Épicerie"],
    ["Riz 1kg", 160, "Épicerie"],
    ["Chips 150g", 100, "Snacks"],
    ["Chocolat tablette", 140, "Snacks"],
  ],
  boulangerie: [
    ["Baguette", 15, "Pains"],
    ["Pain de campagne", 40, "Pains"],
    ["Croissant", 35, "Viennoiserie"],
    ["Pain au chocolat", 40, "Viennoiserie"],
    ["Msemen", 25, "Traditionnel"],
    ["Gâteau sec (kg)", 800, "Pâtisserie"],
    ["Pâtisserie orientale (kg)", 1200, "Pâtisserie"],
  ],
  pizzeria: [
    ["Pizza Margherita", 600, "Pizzas"],
    ["Pizza 4 fromages", 850, "Pizzas"],
    ["Pizza pepperoni", 900, "Pizzas"],
    ["Calzone", 750, "Pizzas"],
    ["Tacos poulet", 500, "Tacos"],
    ["Frites", 200, "Accompagnements"],
    ["Soda cola 33cl", 90, "Boissons"],
  ],
  fast_food: [
    ["Burger maison", 450, "Burgers"],
    ["Double cheese", 650, "Burgers"],
    ["Tacos viande", 550, "Tacos"],
    ["Sandwich poulet", 400, "Sandwichs"],
    ["Frites", 200, "Accompagnements"],
    ["Salade César", 350, "Salades"],
    ["Soda cola 33cl", 90, "Boissons"],
  ],
  restaurant: [
    ["Couscous royal", 950, "Plats"],
    ["Assiette grillade", 1100, "Plats"],
    ["Poulet rôti", 800, "Plats"],
    ["Salade variée", 350, "Entrées"],
    ["Merguez frites", 600, "Plats"],
    ["Jus d'orange frais", 200, "Boissons"],
  ],
  boucherie: [
    ["Viande de bœuf (kg)", 2200, "Bœuf"],
    ["Escalope de poulet (kg)", 900, "Volaille"],
    ["Merguez (kg)", 1400, "Charcuterie"],
    ["Poulet entier (kg)", 750, "Volaille"],
    ["Côtelettes d'agneau (kg)", 2600, "Agneau"],
  ],
  fruits_legumes: [
    ["Tomates (kg)", 120, "Légumes"],
    ["Pommes de terre (kg)", 80, "Légumes"],
    ["Bananes (kg)", 250, "Fruits"],
    ["Oranges (kg)", 130, "Fruits"],
    ["Pommes (kg)", 220, "Fruits"],
    ["Oignons (kg)", 70, "Légumes"],
    ["Salade verte", 60, "Légumes"],
  ],
  cafe: [
    ["Café expresso", 60, "Cafés"],
    ["Cappuccino", 120, "Cafés"],
    ["Thé à la menthe", 80, "Boissons"],
    ["Jus d'orange frais", 200, "Boissons"],
    ["Croissant", 50, "En-cas"],
    ["Gâteau du jour", 150, "En-cas"],
  ],
  glacier: [
    ["Glace 2 boules", 200, "Glaces"],
    ["Glace 3 boules", 280, "Glaces"],
    ["Sorbet citron", 180, "Glaces"],
    ["Coupe chantilly", 350, "Coupes"],
    ["Milkshake", 300, "Boissons"],
  ],
  pharmacie: [
    ["Gel hydroalcoolique 100ml", 250, "Hygiène"],
    ["Sérum physiologique x10", 200, "Soins"],
    ["Crème hydratante", 650, "Soins"],
    ["Vitamine C effervescente", 300, "Compléments"],
    ["Pansements assortis", 180, "Premiers soins"],
  ],
};

// ── Commerçants (10 wilayas ; le flagship Akbou appartient à thefast) ───────
const M = [
  // 06 Béjaïa — Akbou (flagship thefast) + Béjaïa
  {
    flag: true,
    name: "The Fast Market",
    cat: "superette",
    w: "06",
    ville: "Béjaïa",
    com: "Akbou",
    lat: 36.4561,
    lng: 4.5447,
  },
  {
    name: "Boulangerie El Baraka",
    cat: "boulangerie",
    w: "06",
    ville: "Béjaïa",
    com: "Akbou",
    lat: 36.4599,
    lng: 4.5401,
  },
  {
    name: "Pizzeria Bejaia Napoli",
    cat: "pizzeria",
    w: "06",
    ville: "Béjaïa",
    com: "Béjaïa",
    lat: 36.7558,
    lng: 5.0843,
  },
  {
    name: "Restaurant Le Dauphin",
    cat: "restaurant",
    w: "06",
    ville: "Béjaïa",
    com: "Béjaïa",
    lat: 36.7489,
    lng: 5.076,
  },
  // 16 Alger
  {
    name: "Superette Alger Centre",
    cat: "superette",
    w: "16",
    ville: "Alger",
    com: "Alger Centre",
    lat: 36.7538,
    lng: 3.0588,
  },
  {
    name: "Fast Food Bab Ezzouar",
    cat: "fast_food",
    w: "16",
    ville: "Alger",
    com: "Bab Ezzouar",
    lat: 36.7166,
    lng: 3.1836,
  },
  {
    name: "Café Le Milk Bar",
    cat: "cafe",
    w: "16",
    ville: "Alger",
    com: "Alger Centre",
    lat: 36.7701,
    lng: 3.0589,
  },
  // 31 Oran
  {
    name: "Superette El Bahia",
    cat: "superette",
    w: "31",
    ville: "Oran",
    com: "Oran",
    lat: 35.6971,
    lng: -0.6337,
  },
  {
    name: "Pizzeria Oran Sud",
    cat: "pizzeria",
    w: "31",
    ville: "Oran",
    com: "Oran",
    lat: 35.6889,
    lng: -0.6412,
  },
  {
    name: "Glacier La Corniche",
    cat: "glacier",
    w: "31",
    ville: "Oran",
    com: "Oran",
    lat: 35.7051,
    lng: -0.6501,
  },
  // 25 Constantine
  {
    name: "Boucherie El Hidhab",
    cat: "boucherie",
    w: "25",
    ville: "Constantine",
    com: "Constantine",
    lat: 36.365,
    lng: 6.6147,
  },
  {
    name: "Restaurant Les Ponts",
    cat: "restaurant",
    w: "25",
    ville: "Constantine",
    com: "Constantine",
    lat: 36.3701,
    lng: 6.6099,
  },
  // 19 Sétif
  {
    name: "Superette Ain Fouara",
    cat: "superette",
    w: "19",
    ville: "Sétif",
    com: "Sétif",
    lat: 36.1919,
    lng: 5.4139,
  },
  {
    name: "Boulangerie Sétif Centre",
    cat: "boulangerie",
    w: "19",
    ville: "Sétif",
    com: "Sétif",
    lat: 36.1888,
    lng: 5.4101,
  },
  // 15 Tizi Ouzou
  {
    name: "Primeur Djurdjura",
    cat: "fruits_legumes",
    w: "15",
    ville: "Tizi Ouzou",
    com: "Tizi Ouzou",
    lat: 36.7169,
    lng: 4.0497,
  },
  {
    name: "Fast Food Tizi Grill",
    cat: "fast_food",
    w: "15",
    ville: "Tizi Ouzou",
    com: "Tizi Ouzou",
    lat: 36.7112,
    lng: 4.0451,
  },
  // 09 Blida
  {
    name: "Superette Roses de Blida",
    cat: "superette",
    w: "09",
    ville: "Blida",
    com: "Blida",
    lat: 36.4703,
    lng: 2.8277,
  },
  {
    name: "Pâtisserie Ville des Roses",
    cat: "boulangerie",
    w: "09",
    ville: "Blida",
    com: "Blida",
    lat: 36.4756,
    lng: 2.8301,
  },
  // 23 Annaba
  {
    name: "Poissonnerie Annaba Marine",
    cat: "restaurant",
    w: "23",
    ville: "Annaba",
    com: "Annaba",
    lat: 36.9,
    lng: 7.7667,
  },
  {
    name: "Café Cours de la Révolution",
    cat: "cafe",
    w: "23",
    ville: "Annaba",
    com: "Annaba",
    lat: 36.8981,
    lng: 7.7551,
  },
  // 05 Batna
  {
    name: "Superette Aurès",
    cat: "superette",
    w: "05",
    ville: "Batna",
    com: "Batna",
    lat: 35.5559,
    lng: 6.1741,
  },
  {
    name: "Pharmacie Ibn Sina",
    cat: "pharmacie",
    w: "05",
    ville: "Batna",
    com: "Batna",
    lat: 35.5601,
    lng: 6.1699,
  },
  // 13 Tlemcen
  {
    name: "Boulangerie Tlemcen Médina",
    cat: "boulangerie",
    w: "13",
    ville: "Tlemcen",
    com: "Tlemcen",
    lat: 34.8828,
    lng: -1.315,
  },
  {
    name: "Restaurant Lalla Setti",
    cat: "restaurant",
    w: "13",
    ville: "Tlemcen",
    com: "Tlemcen",
    lat: 34.8701,
    lng: -1.3221,
  },
];

const slugify = (s) =>
  s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "");

async function addProducts(merchantId, category) {
  const has = await c.query(
    "select 1 from products where merchant_id=$1 limit 1",
    [merchantId]
  );
  if (has.rows.length) return 0;
  const list = T[category] ?? T.superette;
  const cover = await coverFor(category);
  let pos = 0;
  for (const [name, price, sub] of list) {
    let img = photoFor(name);
    if (!(await checkUrl(img))) img = cover; // repli couverture (vérifiée)
    await c.query(
      `insert into products (merchant_id, name_fr, price_da, category, unit, image_url, is_available, position)
       values ($1,$2,$3,$4,'piece',$5,true,$6)`,
      [merchantId, name, price, sub, img, pos++]
    );
  }
  return list.length;
}

// ═══════════════════════════ 1) COMMERÇANTS ═══════════════════════════════
console.log("── Commerçants ──");
let flagshipId = null;
const thefastUserId = await ensureAuthUser(
  "thefast.contact@gmail.com",
  "thefast.contact@gmail.com"
);

for (const m of M) {
  const slug = slugify(m.name);
  const existing = await c.query("select id from merchants where slug=$1", [
    slug,
  ]);
  let mid;
  if (existing.rows.length) {
    mid = existing.rows[0].id;
    console.log(`= ${m.name} (déjà présent)`);
  } else {
    const userId = m.flag
      ? thefastUserId
      : await ensureAuthUser(
          `seed.${slug}@coligo.local`,
          `seed.${slug}@coligo.local`
        );
    const cover = await coverFor(m.cat);
    const ins = await c.query(
      `insert into merchants
         (user_id, name, slug, shop_public_id, category, city, wilaya_code, commune,
          latitude, longitude, cover_url, is_active, delivery_enabled, express_enabled,
          tours_enabled, accepts_cash, accepts_online, prep_time_min, min_order_da,
          opening_hours, approval_status, description_fr)
       values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,true,true,true,true,true,true,12,300,$12,'approved',$13)
       returning id`,
      [
        userId,
        m.name,
        slug,
        hex12(),
        m.cat,
        m.ville,
        m.w,
        m.com,
        m.lat,
        m.lng,
        cover,
        JSON.stringify(OPEN),
        `${m.name} — commerce de test à ${m.com}. Produits frais, livraison Express et Tournée.`,
      ]
    );
    mid = ins.rows[0].id;
    await c.query(
      `insert into merchant_category_links (merchant_id, code, source) values ($1,$2,'manual')
       on conflict do nothing`,
      [mid, m.cat]
    );
    console.log(`+ ${m.name} · ${m.com} (${m.w})`);
  }
  if (m.flag) flagshipId = mid;
  const n = await addProducts(mid, m.cat);
  if (n) console.log(`    + ${n} produits`);
}

// ═══════════════════════════ 2) CLIENT ════════════════════════════════════
console.log("\n── Client ──");
const clientUserId = await ensureAuthUser(
  "qawaexpress@gmail.com",
  "qawaexpress@gmail.com"
);
let clientId;
const cx = await c.query("select id from customers where user_id=$1", [
  clientUserId,
]);
if (cx.rows.length) {
  clientId = cx.rows[0].id;
  console.log("= Client qawaexpress (déjà présent)");
} else {
  const ins = await c.query(
    `insert into customers (user_id, full_name, phone, email, default_wilaya_code, default_commune, latitude, longitude)
     values ($1,'Qawa Express','+213661234567','qawaexpress@gmail.com','06','Akbou',36.4561,4.5447)
     returning id`,
    [clientUserId]
  );
  clientId = ins.rows[0].id;
  console.log("+ Client qawaexpress créé");
}

// ═══════════════════════════ 3) LIVREUR ═══════════════════════════════════
console.log("\n── Livreur ──");
const driverUserId = await ensureAuthUser(
  "003044618@drivers.coligo.local",
  "003044618"
);
let driverId;
const dx = await c.query("select id from drivers where user_id=$1", [
  driverUserId,
]);
if (dx.rows.length) {
  driverId = dx.rows[0].id;
  console.log("= Livreur 003044618 (déjà présent)");
} else {
  const ins = await c.query(
    `insert into drivers (user_id, full_name, phone, wilaya, vehicle_type, vehicle_brand, vehicle_model,
                          vehicle_plate, vehicle_color, is_verified, verified_at, work_zone_lat, work_zone_lng, work_zone_radius_km)
     values ($1,'Livreur Test','003044618','Béjaïa','moto','Yamaha','NMAX','06-2024-118','Noir',true,now(),36.4561,4.5447,8)
     returning id`,
    [driverUserId]
  );
  driverId = ins.rows[0].id;
  // Rattache le livreur au flagship (tournées) — si le lien merchant_drivers existe.
  try {
    await c.query(
      `insert into merchant_drivers (merchant_id, driver_id, status) values ($1,$2,'active')
       on conflict do nothing`,
      [flagshipId, driverId]
    );
  } catch {
    /* table/contrainte différente — ignore */
  }
  console.log("+ Livreur 003044618 créé (vérifié, Béjaïa)");
}

// ═══════════════════════════ 4) CHAUFFEUR ═════════════════════════════════
console.log("\n── Chauffeur ──");
const chUserId = await ensureAuthUser(
  "003044618@chauffeurs.coligo.local",
  "003044618"
);
const chx = await c.query("select id from chauffeurs where user_id=$1", [
  chUserId,
]);
if (chx.rows.length) {
  console.log("= Chauffeur 003044618 (déjà présent)");
} else {
  await c.query(
    `insert into chauffeurs (user_id, full_name, first_name, phone, wilaya, city, gamme,
                             vehicle_make, vehicle_model, vehicle_plate, vehicle_color,
                             is_verified, verified_at, submitted_at, ccp_number,
                             home_addr_text, home_lat, home_lng)
     values ($1,'Chauffeur Test','Chauffeur','003044618','Béjaïa','Akbou','confort',
             'Renault','Symbol','06-2023-618','Blanc',true,now(),now(),'0012345678901234',
             'Akbou centre, Béjaïa',36.4561,4.5447)`,
    [chUserId]
  );
  console.log("+ Chauffeur 003044618 créé (vérifié, gamme confort)");
}

// ═══════════════════════════ 5) AGENT COLIGO PAY ══════════════════════════
console.log("\n── Agent Coligo Pay ──");
const agentUserId = await ensureAuthUser(
  "0603044618@partners.coligo.local",
  "0603044618"
);
const ax = await c.query(
  "select id from operator_wallets where owner_type='partner' and owner_id=$1",
  [agentUserId]
);
if (ax.rows.length) {
  console.log("= Agent Coligo Pay 0603044618 (déjà présent)");
} else {
  await c.query(
    `insert into operator_wallets (owner_type, owner_id, is_partner, status, display_name,
                                   owner_name, address, wilaya, commune, lat, lng, phone,
                                   registre_commerce, is_verified, verified_at, submitted_at)
     values ('partner',$1,true,'active','Agent Coligo Pay Akbou','Agent Test',
             'Rue principale, Akbou','Béjaïa','Akbou',36.4561,4.5447,'0603044618',
             '06/00-1234567 B 24',true,now(),now())`,
    [agentUserId]
  );
  console.log("+ Agent Coligo Pay 0603044618 créé (actif, vérifié, Akbou)");
}

// ═══════════════════════════ 6) COMMANDES DÉMO ════════════════════════════
console.log("\n── Commandes de démo (flagship → client) ──");
const already = await c.query(
  "select 1 from orders where customer_id=$1 limit 1",
  [clientId]
);
if (already.rows.length) {
  console.log("= Commandes déjà présentes, skip");
} else {
  async function order({ mode, payment, addr, lat, lng, items }) {
    const subtotal = items.reduce((s, it) => s + it.p * it.q, 0);
    const fee = mode === "express" ? 200 : 150;
    const o = await c.query(
      `insert into orders
         (merchant_id, customer_id, customer_name, customer_phone, status, subtotal_da,
          total_da, delivery_fee_da, pickup_code, pickup_slot_at, payment_method, payment_status,
          fulfillment_type, delivery_mode, delivery_address_text, delivery_lat, delivery_lng, delivery_phone)
       values ($1,$2,'Qawa Express','+213661234567','preparing',$3,$4,$5,$6,now(),$7,$8,
               'delivery',$9,$10,$11,$12,'+213661234567')
       returning id`,
      [
        flagshipId,
        clientId,
        subtotal,
        subtotal + fee,
        fee,
        code6(),
        payment,
        payment === "online" ? "paid" : "pending",
        mode,
        addr,
        lat,
        lng,
      ]
    );
    const oid = o.rows[0].id;
    for (const it of items) {
      await c.query(
        `insert into order_items (order_id, product_name, unit_price_da, quantity, line_total_da)
         values ($1,$2,$3,$4,$5)`,
        [oid, it.n, it.p, it.q, it.p * it.q]
      );
    }
    return oid;
  }
  await order({
    mode: "express",
    payment: "cash",
    addr: "Cité Tobbal, Akbou",
    lat: 36.457,
    lng: 4.545,
    items: [
      { n: "Lait UHT 1L", p: 120, q: 2 },
      { n: "Eau minérale 1.5L", p: 40, q: 3 },
      { n: "Chips 150g", p: 100, q: 1 },
    ],
  });
  await order({
    mode: "tour",
    payment: "online",
    addr: "Rue de la Liberté, Akbou",
    lat: 36.459,
    lng: 4.542,
    items: [
      { n: "Riz 1kg", p: 160, q: 1 },
      { n: "Huile de table 1L", p: 290, q: 1 },
    ],
  });
  await order({
    mode: "tour",
    payment: "cash",
    addr: "Quartier Aamriw, Béjaïa",
    lat: 36.7565,
    lng: 5.055,
    items: [
      { n: "Café moulu 250g", p: 320, q: 1 },
      { n: "Sucre 1kg", p: 130, q: 2 },
    ],
  });
  console.log("+ 3 commandes créées (1 Express, 2 Tournée)");
}

await c.end();
console.log(
  `\n✅ Seed DEV terminé. Images vérifiées : ${[...urlOk.values()].filter(Boolean).length}/${urlOk.size} OK.`
);
