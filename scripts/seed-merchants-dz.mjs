/**
 * Seed « terrain Algérie » : 20 commerçants réels-plausibles à Béjaïa centre,
 * Alger centre, Draria et Tizi Ouzou centre — supérettes, boulangeries /
 * pâtisseries, fast-foods et restaurants — avec catalogues, photos et prix
 * algériens, livraison au kilométrage dans un rayon de 10 km.
 *
 *   node scripts/seed-merchants-dz.mjs            # banque d'images + 20 commerçants
 *   node scripts/seed-merchants-dz.mjs --bank     # banque d'images seulement
 *   node scripts/seed-merchants-dz.mjs --merchants# commerçants seulement
 *
 * Idempotent : les commerçants `dz-*` et les comptes `@dz.coligo.app` sont
 * recréés à chaque exécution ; la banque d'images n'est jamais re-téléversée
 * si l'objet existe déjà.
 *
 * Sources d'images :
 *   - produits préparés → ../catalog-photos-food (Wikimedia Commons, licences
 *     libres commerciales, crédits conservés dans merchant_image_bank) ;
 *   - packshots supérette → catalogue réel déjà présent en base, recopié dans
 *     un espace de banque partagé (products/bank/superette/...).
 */
import { readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";
import sharp from "sharp";
import { createClient } from "@supabase/supabase-js";
import { getDbUrl, loadEnvLocal } from "./_supabase.mjs";
import { FOOD_ITEMS } from "./food-photo-bank-items.mjs";
import {
  MERCHANTS,
  TYPE_DEFAULTS,
  DELIVERY_BANDS,
} from "./seed-merchants-dz-data.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
const FOOD_DIR = join(ROOT, "..", "catalog-photos-food");
/** Catalogue supérette de référence (commerçant réel déjà en base). */
const SOURCE_SUPERETTE = "9192b8e4-31d3-4490-8c9e-0826cc2cdcd2";

const args = process.argv.slice(2);
const ONLY_BANK = args.includes("--bank");
const ONLY_MERCHANTS = args.includes("--merchants");

loadEnvLocal();
const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);
const PUBLIC_BASE = `${process.env.NEXT_PUBLIC_SUPABASE_URL}/storage/v1/object/public`;

// =============================================================================
// Utilitaires
// =============================================================================
const slugify = (s) =>
  s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "");

/** PRNG déterministe : même slug ⇒ même catalogue à chaque exécution. */
function rngFor(seed) {
  let h = 1779033703 ^ seed.length;
  for (let i = 0; i < seed.length; i++) {
    h = Math.imul(h ^ seed.charCodeAt(i), 3432918353);
    h = (h << 13) | (h >>> 19);
  }
  return () => {
    h = Math.imul(h ^ (h >>> 16), 2246822507);
    h = Math.imul(h ^ (h >>> 13), 3266489909);
    h ^= h >>> 16;
    return (h >>> 0) / 4294967296;
  };
}

const roundTo = (v, step) => Math.max(step, Math.round(v / step) * step);

// =============================================================================
// 1. BANQUE D'IMAGES — produits préparés (Commons) + packshots supérette
// =============================================================================
async function uploadFoodBank(client) {
  const manifest = JSON.parse(
    readFileSync(join(FOOD_DIR, "_manifest.json"), "utf8")
  );
  const urls = new Map();
  let uploaded = 0;

  for (const e of manifest) {
    const local = join(FOOD_DIR, e.family, `${e.slug}.jpg`);
    if (!existsSync(local)) {
      console.warn(`   ⚠ image manquante : ${e.slug}`);
      continue;
    }
    const path =
      e.kind === "category"
        ? `bank/food/categories/${e.slug}.jpg`
        : `bank/food/${e.family}/${e.slug}.jpg`;
    const url = `${PUBLIC_BASE}/products/${path}`;
    urls.set(e.slug, url);

    const { data: head } = await sb.storage
      .from("products")
      .list(dirname(path).replace(/\\/g, "/"), { search: `${e.slug}.jpg` });
    if (head?.length) continue;

    const { error } = await sb.storage
      .from("products")
      .upload(path, readFileSync(local), {
        contentType: "image/jpeg",
        upsert: true,
      });
    if (error) throw new Error(`upload ${path} : ${error.message}`);
    uploaded++;
  }

  // Enregistrement en banque (avec les crédits de licence).
  for (const e of manifest) {
    const url = urls.get(e.slug);
    if (!url) continue;
    const family =
      e.kind === "category"
        ? null
        : e.family === "patisserie"
          ? "boulangerie"
          : e.family;
    await client.query(
      `insert into public.merchant_image_bank
         (kind, category, label, url, position, credit_author, credit_license, source_url)
       values ($1,$2,$3,$4,$5,$6,$7,$8)
       on conflict (kind, url) do update
         set label = excluded.label,
             category = excluded.category,
             credit_author = excluded.credit_author,
             credit_license = excluded.credit_license,
             source_url = excluded.source_url`,
      [
        e.kind === "category" ? "category" : "product",
        family,
        e.label,
        url,
        100,
        e.author,
        e.license,
        e.source,
      ]
    );
  }
  console.log(
    `✅ Banque « plats préparés » : ${manifest.length} visuels (${uploaded} téléversés)`
  );
  return urls;
}

/**
 * Recopie les packshots du catalogue supérette réel dans un espace de banque
 * PARTAGÉ (indépendant du commerçant d'origine) et renvoie la liste des
 * produits de référence.
 */
async function buildSuperetteBank(client) {
  const { rows } = await client.query(
    `select p.name_fr, p.name_ar, p.price_da, p.unit::text as unit,
            c.title as cat, p.image_url
       from public.products p
       join public.categories c on c.id = p.category_id
      where p.merchant_id = $1
        and p.image_url is not null
        and p.archived_at is null
      order by c.title, p.name_fr`,
    [SOURCE_SUPERETTE]
  );

  const prefix = `${PUBLIC_BASE}/products/`;
  const items = [];
  let copied = 0;
  const seenDirs = new Map();

  for (const r of rows) {
    if (!r.image_url.startsWith(prefix)) continue;
    const srcPath = decodeURIComponent(r.image_url.slice(prefix.length));
    const file = srcPath.split("/").pop();
    const dir = `bank/superette/${slugify(r.cat)}`;
    const destPath = `${dir}/${file}`;

    if (!seenDirs.has(dir)) {
      const { data } = await sb.storage.from("products").list(dir, {
        limit: 1000,
      });
      seenDirs.set(dir, new Set((data ?? []).map((o) => o.name)));
    }
    if (!seenDirs.get(dir).has(file)) {
      const { error } = await sb.storage
        .from("products")
        .copy(srcPath, destPath);
      if (error && !/exists/i.test(error.message)) {
        console.warn(`   ⚠ copie ${file} : ${error.message}`);
        continue;
      }
      seenDirs.get(dir).add(file);
      copied++;
    }
    items.push({
      name_fr: r.name_fr,
      name_ar: r.name_ar,
      price_da: r.price_da,
      unit: r.unit,
      cat: r.cat,
      url: `${PUBLIC_BASE}/products/${destPath}`,
    });
  }

  // Un échantillon par rayon entre en banque (garder 514 lignes n'apporterait
  // rien à l'admin ; les produits, eux, pointent tous vers la banque).
  const perCat = new Map();
  for (const it of items) {
    const list = perCat.get(it.cat) ?? [];
    if (list.length < 8) list.push(it);
    perCat.set(it.cat, list);
  }
  for (const [cat, list] of perCat) {
    for (const it of list) {
      await client.query(
        `insert into public.merchant_image_bank
           (kind, category, label, url, position, credit_author, credit_license, source_url)
         values ('product','superette',$1,$2,100,$3,$4,null)
         on conflict (kind, url) do nothing`,
        [
          `${it.name_fr} · ${cat}`,
          it.url,
          "Catalogue commerçant Coligo",
          "Fourni par le commerçant",
        ]
      );
    }
  }
  console.log(
    `✅ Banque supérette : ${items.length} packshots (${copied} copiés) sur ${perCat.size} rayons`
  );
  return items;
}

/** Images de rayon déjà en banque (mig 0348 + vague food). */
async function loadCategoryImages(client) {
  const { rows } = await client.query(
    `select label, url from public.merchant_image_bank where kind = 'category'`
  );
  return new Map(rows.map((r) => [r.label, r.url]));
}

// =============================================================================
// 2. LOGOS — pastille de marque générée (initiales + dégradé par type)
// =============================================================================
const LOGO_COLORS = {
  superette: ["#6C2BD9", "#4B1FA6"],
  boulangerie: ["#F0A22E", "#C2670B"],
  fast_food: ["#E23744", "#A11324"],
  restaurant: ["#14855F", "#0A5C41"],
};

async function uploadLogo(m) {
  const path = `${m.slug}.png`;
  const { data } = await sb.storage
    .from("merchant-logos")
    .list("", { search: path });
  const url = `${PUBLIC_BASE}/merchant-logos/${path}`;
  if (data?.some((o) => o.name === path)) return url;

  const initials = m.name
    .replace(
      /^(Supérette|Restaurant|Boulangerie|Pâtisserie|Fast Food|Le|La|Les)\s+/i,
      ""
    )
    .split(/\s+/)
    .slice(0, 2)
    .map((w) => w[0]?.toUpperCase() ?? "")
    .join("");
  const [c1, c2] = LOGO_COLORS[m.type];
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512">
  <defs><linearGradient id="g" x1="0" y1="0" x2="1" y2="1">
    <stop offset="0%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/>
  </linearGradient></defs>
  <rect width="512" height="512" rx="128" fill="url(#g)"/>
  <text x="256" y="256" font-family="Segoe UI, Arial, sans-serif" font-size="200"
        font-weight="700" fill="#ffffff" text-anchor="middle"
        dominant-baseline="central">${initials}</text>
</svg>`;
  const png = await sharp(Buffer.from(svg)).png().toBuffer();
  const { error } = await sb.storage
    .from("merchant-logos")
    .upload(path, png, { contentType: "image/png", upsert: true });
  if (error) throw new Error(`logo ${m.slug} : ${error.message}`);
  return url;
}

// =============================================================================
// 3. CATALOGUES
// =============================================================================
/** Rayon supérette → image de rayon (banque). */
const SUPERETTE_CAT_IMAGE = {
  "Boissons et Eaux": "Boissons",
  "Biscuits et snacks": "Biscuits et snacks",
  "Confiserie et Chocolat": "Snacks sucrés & confiserie",
  Épicerie: "Épicerie",
  "Bébé et Puériculture": "Bébé et puériculture",
  "Hygiène et Beauté": "Hygiène & beauté",
  Pâtisserie: "Ingrédients pâtisserie",
  Boulangeries: "Boulangerie & pains",
  "Pâtes Riz et Céréales": "Pâtes, riz et céréales",
  "Petit déjeuner": "Petit déjeuner",
  "Entretien maison": "Entretien maison",
  "Café Thé et Boissons chaudes": "Café, thé & cacao",
  "Yaourts et desserts": "Produits laitiers & œufs",
  "Fruits et légumes": "Fruits et légumes",
  "Produits frais": "Produits frais",
  "Huiles Sauces et Épices": "Huiles, sauces et épices",
};

/** Rayon « plats préparés » → image de rayon (banque). */
const FOOD_CAT_IMAGE = {
  Pains: "Pains",
  Viennoiseries: "Viennoiseries",
  Traditionnel: "Traditionnel",
  "Gâteaux algériens": "Gâteaux algériens",
  "Pâtisserie française": "Pâtisserie française",
  Gâteaux: "Gâteaux",
  "Crêpes & gaufres": "Crêpes & gaufres",
  Burgers: "Burgers",
  "Tacos & sandwichs": "Tacos & sandwichs",
  Pizzas: "Pizzas",
  Accompagnements: "Accompagnements",
  Boissons: "Boissons",
  "Entrées & soupes": "Entrées & soupes",
  "Plats traditionnels": "Plats traditionnels",
  Grillades: "Grillades",
  Poissons: "Poissons",
  Salades: "Salades",
  Desserts: "Desserts",
};

/** Familles d'items servies par type de commerce. */
const FAMILIES_BY_TYPE = {
  boulangerie: ["boulangerie", "patisserie"],
  fast_food: ["fast_food"],
  restaurant: ["restaurant"],
};

/** Construit le catalogue (rayons + produits) d'un commerçant. */
function buildCatalog(m, superetteItems, foodUrls) {
  const rnd = rngFor(m.slug);

  if (m.type === "superette") {
    // Échantillonnage RAYON PAR RAYON : chaque supérette garde tous ses rayons
    // (un plafond global tronquerait le catalogue aux premières lettres).
    const byCat = new Map();
    for (const it of superetteItems) {
      if (!byCat.has(it.cat)) byCat.set(it.cat, []);
      byCat.get(it.cat).push(it);
    }
    const picked = [];
    for (const [, list] of byCat) {
      const share = 0.4 + rnd() * 0.25; // 40–65 % du rayon
      const take = Math.max(3, Math.min(22, Math.round(list.length * share)));
      const shuffled = [...list].sort(() => rnd() - 0.5);
      picked.push(...shuffled.slice(0, take));
    }
    const factor = 0.94 + rnd() * 0.12; // ±6 % sur les prix relevés
    return groupCatalog(
      picked.map((it) => ({
        name_fr: it.name_fr,
        name_ar: it.name_ar,
        price_da: roundTo(it.price_da * factor, 5),
        unit: it.unit,
        cat: it.cat,
        image_url: it.url,
      })),
      SUPERETTE_CAT_IMAGE
    );
  }

  const families = FAMILIES_BY_TYPE[m.type];
  const items = FOOD_ITEMS.filter((i) => families.includes(i.family));
  const keep = 0.8 + rnd() * 0.2; // 80–100 % de la carte type
  const factor = 0.92 + rnd() * 0.16; // ±8 % sur les prix
  const picked = items.filter((_, idx) =>
    idx % 7 === 3 ? rnd() < keep : true
  );
  return groupCatalog(
    picked.map((i) => ({
      name_fr: i.name_fr,
      name_ar: i.name_ar,
      price_da: roundTo(i.price_da * factor, i.price_da >= 500 ? 50 : 10),
      unit: "piece",
      cat: i.cat,
      image_url: foodUrls.get(i.slug) ?? null,
    })),
    FOOD_CAT_IMAGE
  );
}

/** Regroupe des produits par rayon, dans l'ordre d'apparition. */
function groupCatalog(products, imageMap) {
  const cats = [];
  const byCat = new Map();
  for (const p of products) {
    if (!byCat.has(p.cat)) {
      byCat.set(p.cat, []);
      cats.push(p.cat);
    }
    byCat.get(p.cat).push(p);
  }
  return cats.map((title, i) => ({
    title,
    position: i,
    imageKey: imageMap[title] ?? null,
    products: byCat.get(title),
  }));
}

// =============================================================================
// 4. CRÉATION DES COMMERÇANTS
// =============================================================================
async function seedMerchants(client, superetteItems, foodUrls, catImages) {
  // Couvertures : banque de visuels par catégorie (mig 0348).
  const { rows: coverRows } = await client.query(
    `select category, url from public.merchant_image_bank
      where kind = 'cover' and active and category is not null
      order by category, position`
  );
  const covers = new Map();
  for (const r of coverRows) {
    const list = covers.get(r.category) ?? [];
    list.push(r.url);
    covers.set(r.category, list);
  }

  console.log("▶ Nettoyage des commerçants de seed précédents…");
  await client.query(`delete from public.merchants where slug like 'dz-%'`);
  await client.query(
    `delete from auth.users where email like '%@dz.coligo.app'`
  );

  const summary = [];
  for (let i = 0; i < MERCHANTS.length; i++) {
    const m = MERCHANTS[i];
    const def = TYPE_DEFAULTS[m.type];
    const email = `${m.slug.replace(/^dz-/, "")}@dz.coligo.app`;

    // 4.1 Compte Auth — tokens à '' (jamais NULL) : GoTrue les lit en string Go.
    const { rows: userRows } = await client.query(
      `insert into auth.users (
         id, instance_id, aud, role, email, encrypted_password,
         email_confirmed_at, raw_app_meta_data, raw_user_meta_data,
         created_at, updated_at,
         confirmation_token, recovery_token, email_change,
         email_change_token_new, email_change_token_current,
         phone_change, phone_change_token, reauthentication_token
       ) values (
         gen_random_uuid(), '00000000-0000-0000-0000-000000000000',
         'authenticated', 'authenticated', $1,
         crypt('coligo2026', gen_salt('bf')), now(),
         jsonb_build_object('provider','email','providers',array['email']),
         jsonb_build_object('seed', true, 'role', 'merchant'),
         now(), now(), '', '', '', '', '', '', '', ''
       ) returning id`,
      [email]
    );
    const userId = userRows[0].id;

    const catCovers = covers.get(m.type) ?? covers.get("superette") ?? [];
    const cover = catCovers.length ? catCovers[i % catCovers.length] : null;
    const logo = await uploadLogo(m);

    const { rows: merchRows } = await client.query(
      `insert into public.merchants (
         user_id, name, category, city, wilaya_code, commune, address,
         description_fr, description_ar, slug, logo_url, cover_url,
         phone_public, manager_name, latitude, longitude, opening_hours,
         min_order_da, prep_time_min, accepts_cash, accepts_online,
         pickup_slot_minutes, catalog_display, tags,
         delivery_enabled, express_enabled, tours_enabled, delivery_radius_km,
         is_active, approval_status, approved_at
       ) values (
         $1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17::jsonb,
         $18,$19,true,true,15,$20,$21,
         true,true,false,10,
         true,'approved',now()
       ) returning id`,
      [
        userId,
        m.name,
        m.type,
        m.city,
        m.wilaya_code,
        m.commune,
        m.address,
        m.desc_fr,
        m.desc_ar,
        m.slug,
        logo,
        cover,
        m.phone,
        m.manager,
        m.lat,
        m.lng,
        JSON.stringify(def.hours),
        def.min_order_da,
        def.prep_time_min,
        def.catalog_display,
        def.tags,
      ]
    );
    const merchantId = merchRows[0].id;

    // 4.2 Livraison au kilométrage — bandes 3 / 6 / 10 km.
    for (const b of DELIVERY_BANDS) {
      await client.query(
        `insert into public.merchant_delivery_zones (merchant_id, band_index, max_km, price_da)
         values ($1,$2,$3,$4)`,
        [merchantId, b.band_index, b.max_km, b.price_da]
      );
    }

    // 4.3 Catalogue.
    const catalog = buildCatalog(m, superetteItems, foodUrls);
    let productCount = 0;
    for (const cat of catalog) {
      const { rows: catRows } = await client.query(
        `insert into public.categories (merchant_id, title, image_url, position)
         values ($1,$2,$3,$4) returning id`,
        [
          merchantId,
          cat.title,
          cat.imageKey ? (catImages.get(cat.imageKey) ?? null) : null,
          cat.position,
        ]
      );
      const categoryId = catRows[0].id;
      for (let pi = 0; pi < cat.products.length; pi++) {
        const p = cat.products[pi];
        await client.query(
          `insert into public.products
             (merchant_id, category_id, name_fr, name_ar, price_da, unit,
              category, image_url, is_available, position)
           values ($1,$2,$3,$4,$5,$6::product_unit,$7,$8,true,$9)`,
          [
            merchantId,
            categoryId,
            p.name_fr,
            p.name_ar,
            p.price_da,
            p.unit,
            cat.title,
            p.image_url,
            pi,
          ]
        );
        productCount++;
      }
    }

    summary.push({
      commerce: m.name,
      type: m.type,
      ville: `${m.commune} (${m.wilaya_code})`,
      rayons: catalog.length,
      produits: productCount,
      email,
    });
    console.log(
      `  • ${m.name} — ${catalog.length} rayons, ${productCount} produits`
    );
  }
  return summary;
}

// =============================================================================
async function main() {
  const client = new pg.Client({
    connectionString: getDbUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  try {
    let foodUrls = new Map();
    let superetteItems = [];

    if (!ONLY_MERCHANTS) {
      console.log("▶ Banque d'images…");
      foodUrls = await uploadFoodBank(client);
      superetteItems = await buildSuperetteBank(client);
    } else {
      const manifest = JSON.parse(
        readFileSync(join(FOOD_DIR, "_manifest.json"), "utf8")
      );
      for (const e of manifest) {
        foodUrls.set(
          e.slug,
          e.kind === "category"
            ? `${PUBLIC_BASE}/products/bank/food/categories/${e.slug}.jpg`
            : `${PUBLIC_BASE}/products/bank/food/${e.family}/${e.slug}.jpg`
        );
      }
      superetteItems = await buildSuperetteBank(client);
    }

    if (ONLY_BANK) {
      console.log("✅ Banque d'images à jour (option --bank).");
      return;
    }

    const catImages = await loadCategoryImages(client);
    console.log("▶ Commerçants…");
    const summary = await seedMerchants(
      client,
      superetteItems,
      foodUrls,
      catImages
    );
    console.table(summary);
    console.log(
      `\n✅ ${summary.length} commerçants créés — mot de passe commun : coligo2026`
    );
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error("❌ Échec du seed :", e);
  process.exit(1);
});
