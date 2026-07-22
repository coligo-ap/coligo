/**
 * Promotions + bannières promo des 20 commerçants « terrain Algérie ».
 *
 *   node scripts/seed-promotions-dz.mjs
 *
 * Chaque commerçant reçoit 2 à 4 offres RÉELLES adaptées à son type (supérette,
 * boulangerie/pâtisserie, fast-food, restaurant), avec les produits concernés
 * quand l'offre porte sur des articles. Chaque offre est ensuite habillée d'une
 * bannière `promo_banners` (modèle + dégradé + illustration 3D du pack maison),
 * ce qui la fait apparaître :
 *   - dans le carrousel d'accueil client (RPC `active_banners_for`, portée =
 *     rayon de livraison du commerçant) ;
 *   - sur la fiche du commerçant, avec le MÊME visuel (getMerchantOfferDesigns).
 *
 * Idempotent : les promos/bannières des commerçants `dz-*` sont recréées.
 */
import pg from "pg";
import { getDbUrl } from "./_supabase.mjs";

const DAY = 24 * 60 * 60 * 1000;

/** PRNG déterministe (même commerçant ⇒ mêmes offres à chaque exécution). */
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

const pick = (rnd, arr) => arr[Math.floor(rnd() * arr.length) % arr.length];

/** Montant en dinars, milliers séparés (« 3 000 DA ») — jamais Intl. */
const da = (n) => `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} DA`;
/** Idem en arabe (« 3 000 دج »). */
const dz = (n) => `${String(n).replace(/\B(?=(\d{3})+(?!\d))/g, " ")} دج`;

/**
 * Catalogues d'offres PAR TYPE de commerce. Chaque entrée sait construire une
 * promotion complète à partir du commerçant, d'un tirage aléatoire déterministe
 * et de ses rayons (pour cibler les bons produits).
 *
 * `rayons` = titres de rayons candidats ; le script prend les produits du
 * premier rayon existant chez ce commerçant.
 */
const OFFER_POOLS = {
  superette: [
    {
      key: "livraison",
      rail: true,
      build: (rnd) => {
        const min = pick(rnd, [2500, 3000, 3500, 4000]);
        return {
          type: "free_delivery",
          title_fr: `Livraison offerte dès ${da(min)}`,
          title_ar: `توصيل مجاني ابتداءً من ${dz(min)}`,
          min_subtotal_da: min,
          banner: {
            title: "Livraison offerte",
            subtitle: `Sur vos courses dès ${da(min)}, en tournée`,
            cta: "Je commande",
            template: "scooter",
            palette: "deliv",
          },
        };
      },
    },
    {
      key: "code",
      rail: true,
      build: (rnd, m) => {
        const val = pick(rnd, [8, 10, 12, 15]);
        const min = pick(rnd, [2000, 2500, 3000]);
        return {
          type: "promo_code",
          title_fr: `${val} % de remise avec le code COURSES${val}`,
          title_ar: `تخفيض ${val}٪ بالرمز COURSES${val}`,
          code: `COURSES${val}${m.suffix}`,
          discount_kind: "percent",
          discount_value: val,
          min_subtotal_da: min,
          max_uses_per_customer: 2,
          banner: {
            title: `Code promo −${val} %`,
            subtitle: `Sur tout le magasin dès ${da(min)} d'achat`,
            cta: "Voir le code",
            template: "megaphone",
            palette: "brand",
          },
        };
      },
    },
    {
      key: "remise-rayon",
      rayons: ["Boissons et Eaux", "Épicerie", "Biscuits et snacks"],
      build: (rnd) => {
        const val = pick(rnd, [10, 15, 20]);
        return {
          type: "product_discount",
          title_fr: `−${val} % sur une sélection d'épicerie`,
          title_ar: `−${val}٪ على تشكيلة من المواد الغذائية`,
          discount_kind: "percent",
          discount_value: val,
          products: 6,
          banner: {
            title: `−${val} % sur la sélection`,
            subtitle: "Les essentiels du placard, au meilleur prix",
            cta: "En profiter",
            template: "percent",
            palette: "brand",
            show_products: true,
          },
        };
      },
    },
    {
      key: "quantite",
      rayons: ["Boissons et Eaux", "Yaourts et desserts", "Produits frais"],
      build: () => ({
        type: "quantity_offer",
        title_fr: "2 achetés = 1 offert sur les boissons",
        title_ar: "قطعتان = واحدة مجاناً على المشروبات",
        buy_qty: 2,
        get_qty: 1,
        products: 5,
        banner: {
          title: "2 achetés = 1 offert",
          subtitle: "Sur une sélection de boissons",
          cta: "Voir la sélection",
          template: "stars",
          palette: "sky",
          show_products: true,
        },
      }),
    },
  ],

  boulangerie: [
    {
      key: "flash",
      rail: true,
      rayons: ["Viennoiseries", "Gâteaux algériens", "Pâtisserie française"],
      build: (rnd) => {
        const val = pick(rnd, [20, 25, 30]);
        return {
          type: "flash_sale",
          title_fr: `Vente flash : −${val} % sur les viennoiseries`,
          title_ar: `عرض خاطف: −${val}٪ على المخبوزات`,
          discount_kind: "percent",
          discount_value: val,
          hours: 12,
          products: 5,
          banner: {
            title: `Vente flash −${val} %`,
            subtitle: "Viennoiseries du jour, jusqu'à épuisement",
            cta: "J'en profite",
            template: "flash",
            palette: "dusk",
          },
        };
      },
    },
    {
      key: "anti-gaspi",
      rail: true,
      rayons: ["Pains", "Traditionnel", "Viennoiseries"],
      build: (rnd) => {
        const val = pick(rnd, [30, 40, 50]);
        return {
          type: "anti_gaspillage",
          title_fr: `Fin de journée : −${val} % sur le pain`,
          title_ar: `نهاية اليوم: −${val}٪ على الخبز`,
          discount_kind: "percent",
          discount_value: val,
          products: 4,
          banner: {
            title: `Anti-gaspi −${val} %`,
            subtitle: "Le pain du jour à petit prix, en fin de journée",
            cta: "Sauver du pain",
            template: "stars",
            palette: "mint",
            show_products: true,
          },
        };
      },
    },
    {
      key: "cadeau",
      rail: true,
      build: (rnd) => {
        const min = pick(rnd, [1200, 1500, 2000]);
        const gift = pick(rnd, [
          "1 baguette offerte",
          "2 msemen offerts",
          "1 part de gâteau offerte",
        ]);
        return {
          type: "free_gift",
          title_fr: `${gift} dès ${da(min)} d'achat`,
          title_ar: `هدية ابتداءً من ${dz(min)}`,
          gift_label: gift,
          min_subtotal_da: min,
          banner: {
            title: gift,
            subtitle: `Offert dès ${da(min)} d'achat`,
            cta: "Voir l'offre",
            template: "gift",
            palette: "brand",
          },
        };
      },
    },
    {
      key: "code-patisserie",
      rail: true,
      build: (rnd, m) => {
        const val = pick(rnd, [10, 15]);
        return {
          type: "promo_code",
          title_fr: `Code SUCRE${val} : −${val} % sur la pâtisserie`,
          title_ar: `الرمز SUCRE${val}: −${val}٪ على الحلويات`,
          code: `SUCRE${val}${m.suffix}`,
          discount_kind: "percent",
          discount_value: val,
          min_subtotal_da: 1000,
          max_uses_per_customer: 3,
          banner: {
            title: `Code SUCRE${val}`,
            subtitle: `−${val} % sur les gâteaux, dès 1 000 DA`,
            cta: "Copier le code",
            template: "megaphone",
            palette: "brand",
          },
        };
      },
    },
  ],

  fast_food: [
    {
      key: "quantite-burger",
      rayons: ["Burgers", "Tacos & sandwichs"],
      build: () => ({
        type: "quantity_offer",
        title_fr: "2 burgers achetés = 1 offert",
        title_ar: "برغران = واحد مجاناً",
        buy_qty: 2,
        get_qty: 1,
        products: 4,
        banner: {
          title: "2 achetés = 1 offert",
          subtitle: "Sur les burgers, midi et soir",
          cta: "Composer ma commande",
          template: "stars",
          palette: "sky",
          show_products: true,
        },
      }),
    },
    {
      key: "remise-pizza",
      rayons: ["Pizzas", "Burgers", "Tacos & sandwichs"],
      build: (rnd) => {
        const val = pick(rnd, [15, 20, 25]);
        return {
          type: "product_discount",
          title_fr: `−${val} % sur les pizzas`,
          title_ar: `−${val}٪ على البيتزا`,
          discount_kind: "percent",
          discount_value: val,
          products: 4,
          banner: {
            title: `Pizzas −${val} %`,
            subtitle: "Pâte fraîche, préparée à la commande",
            cta: "Voir les pizzas",
            template: "percent",
            palette: "brand",
            show_products: true,
          },
        };
      },
    },
    {
      key: "livraison",
      rail: true,
      build: (rnd) => {
        const min = pick(rnd, [1500, 1800, 2000]);
        return {
          type: "free_delivery",
          title_fr: `Livraison offerte dès ${da(min)}`,
          title_ar: `توصيل مجاني ابتداءً من ${dz(min)}`,
          min_subtotal_da: min,
          banner: {
            title: "Livraison offerte",
            subtitle: `Dès ${da(min)} de commande, en tournée`,
            cta: "Je commande",
            template: "scooter",
            palette: "deliv",
          },
        };
      },
    },
    {
      key: "flash-soir",
      rail: true,
      rayons: ["Accompagnements", "Burgers"],
      build: (rnd) => {
        const val = pick(rnd, [20, 30]);
        return {
          type: "flash_sale",
          title_fr: `Happy hour : −${val} % sur les accompagnements`,
          title_ar: `ساعة سعيدة: −${val}٪ على المقبلات`,
          discount_kind: "percent",
          discount_value: val,
          hours: 8,
          products: 4,
          banner: {
            title: `Happy hour −${val} %`,
            subtitle: "Frites, wings et onion rings",
            cta: "J'en profite",
            template: "flash",
            palette: "dusk",
          },
        };
      },
    },
    {
      key: "code",
      rail: true,
      build: (rnd, m) => ({
        type: "promo_code",
        title_fr: "Code TACOS15 : −15 % sur votre commande",
        title_ar: "الرمز TACOS15: −15٪ على طلبك",
        code: `TACOS15${m.suffix}`,
        discount_kind: "percent",
        discount_value: 15,
        min_subtotal_da: 1200,
        max_uses_per_customer: 2,
        banner: {
          title: "Code TACOS15",
          subtitle: "−15 % dès 1 200 DA de commande",
          cta: "Copier le code",
          template: "megaphone",
          palette: "brand",
        },
      }),
    },
  ],

  restaurant: [
    {
      key: "remise-grillades",
      rayons: ["Grillades", "Plats traditionnels", "Poissons"],
      build: (rnd) => {
        const val = pick(rnd, [10, 15, 20]);
        return {
          type: "product_discount",
          title_fr: `−${val} % sur les grillades`,
          title_ar: `−${val}٪ على المشويات`,
          discount_kind: "percent",
          discount_value: val,
          products: 4,
          banner: {
            title: `Grillades −${val} %`,
            subtitle: "Viandes marinées, cuites à la braise",
            cta: "Voir la carte",
            template: "percent",
            palette: "brand",
            show_products: true,
          },
        };
      },
    },
    {
      key: "cadeau-the",
      rail: true,
      build: (rnd) => {
        const min = pick(rnd, [2000, 2500, 3000]);
        const gift = pick(rnd, [
          "Thé à la menthe offert",
          "Dessert maison offert",
          "Salade variée offerte",
        ]);
        return {
          type: "free_gift",
          title_fr: `${gift} dès ${da(min)}`,
          title_ar: `هدية ابتداءً من ${dz(min)}`,
          gift_label: gift,
          min_subtotal_da: min,
          banner: {
            title: gift,
            subtitle: `Offert dès ${da(min)} de commande`,
            cta: "Voir l'offre",
            template: "gift",
            palette: "brand",
          },
        };
      },
    },
    {
      key: "flash-midi",
      rail: true,
      rayons: ["Plats traditionnels", "Entrées & soupes"],
      build: (rnd) => {
        const val = pick(rnd, [15, 20, 25]);
        return {
          type: "flash_sale",
          title_fr: `Menu du midi : −${val} % aujourd'hui`,
          title_ar: `قائمة الغداء: −${val}٪ اليوم`,
          discount_kind: "percent",
          discount_value: val,
          hours: 10,
          products: 4,
          banner: {
            title: `Menu du midi −${val} %`,
            subtitle: "Plats du jour, servis jusqu'à 15 h",
            cta: "Réserver mon plat",
            template: "flash",
            palette: "dusk",
          },
        };
      },
    },
    {
      key: "livraison",
      rail: true,
      build: (rnd) => {
        const min = pick(rnd, [2500, 3000]);
        return {
          type: "free_delivery",
          title_fr: `Livraison offerte dès ${da(min)}`,
          title_ar: `توصيل مجاني ابتداءً من ${dz(min)}`,
          min_subtotal_da: min,
          banner: {
            title: "Livraison offerte",
            subtitle: `Pour les tables de ${da(min)} et plus`,
            cta: "Je commande",
            template: "scooter",
            palette: "deliv",
          },
        };
      },
    },
    {
      key: "code",
      rail: true,
      build: (rnd, m) => ({
        type: "promo_code",
        title_fr: "Code RESTO10 : −10 % à emporter",
        title_ar: "الرمز RESTO10: −10٪ للأخذ",
        code: `RESTO10${m.suffix}`,
        discount_kind: "percent",
        discount_value: 10,
        min_subtotal_da: 1500,
        max_uses_per_customer: 4,
        banner: {
          title: "Code RESTO10",
          subtitle: "−10 % dès 1 500 DA, à emporter ou livré",
          cta: "Copier le code",
          template: "megaphone",
          palette: "brand",
        },
      }),
    },
  ],
};

async function main() {
  const client = new pg.Client({
    connectionString: getDbUrl(),
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();

  try {
    const { rows: merchants } = await client.query(
      `select id, slug, name, category from public.merchants
        where slug like 'dz-%' order by created_at`
    );
    if (!merchants.length) throw new Error("aucun commerçant dz-* en base");

    console.log("▶ Nettoyage des offres de seed précédentes…");
    await client.query(
      `delete from public.promo_banners
        where merchant_id in (select id from public.merchants where slug like 'dz-%')`
    );
    await client.query(
      `delete from public.promotions
        where merchant_id in (select id from public.merchants where slug like 'dz-%')`
    );

    const summary = [];
    for (let mi = 0; mi < merchants.length; mi++) {
      const m = merchants[mi];
      const rnd = rngFor(`${m.slug}-promos`);
      const pool = OFFER_POOLS[m.category] ?? OFFER_POOLS.superette;
      const suffix = String(mi + 1).padStart(2, "0");

      // 2 à 4 offres, tirées SANS remise dans le catalogue du type.
      const count = 2 + Math.floor(rnd() * 3);
      const order = [...pool].sort(() => rnd() - 0.5).slice(0, count);
      // Au moins UNE offre « bande d'offres » (code, cadeau, livraison, flash,
      // anti-gaspi) : les réductions produit s'affichent en carrousels de
      // produits, pas en bannière — sans ça, une boutique pourrait n'avoir
      // aucune bannière sur sa fiche.
      if (!order.some((o) => o.rail)) {
        const railPool = pool.filter((o) => o.rail);
        if (railPool.length) {
          order[order.length - 1] =
            railPool[Math.floor(rnd() * railPool.length)];
        }
      }

      // Rayons du commerçant (pour cibler les produits des offres).
      const { rows: cats } = await client.query(
        `select id, title from public.categories where merchant_id = $1`,
        [m.id]
      );

      const created = [];
      for (let oi = 0; oi < order.length; oi++) {
        const spec = order[oi].build(rnd, { suffix });
        const now = new Date();
        const endsAt = spec.hours
          ? new Date(now.getTime() + spec.hours * 3600 * 1000)
          : new Date(now.getTime() + (20 + Math.floor(rnd() * 40)) * DAY);

        const { rows: promoRows } = await client.query(
          `insert into public.promotions (
             merchant_id, type, title_fr, title_ar, status,
             discount_kind, discount_value, code, buy_qty, get_qty,
             starts_at, ends_at, max_uses_per_customer, min_subtotal_da,
             gift_label, financeur
           ) values (
             $1,$2::promotion_type,$3,$4,'active',
             $5::discount_kind,$6,$7,$8,$9,
             now(),$10,$11,$12,$13,'merchant'
           ) returning id`,
          [
            m.id,
            spec.type,
            spec.title_fr,
            spec.title_ar ?? null,
            spec.discount_kind ?? null,
            spec.discount_value ?? null,
            spec.code ?? null,
            spec.buy_qty ?? null,
            spec.get_qty ?? null,
            endsAt.toISOString(),
            spec.max_uses_per_customer ?? null,
            spec.min_subtotal_da ?? null,
            spec.gift_label ?? null,
          ]
        );
        const promoId = promoRows[0].id;

        // Produits concernés : premier rayon candidat réellement présent.
        let productCount = 0;
        if (spec.products) {
          const wanted = order[oi].rayons ?? [];
          const cat =
            cats.find((c) => wanted.includes(c.title)) ??
            cats[Math.floor(rnd() * cats.length)];
          if (cat) {
            const { rowCount } = await client.query(
              `insert into public.promotion_products (promotion_id, product_id)
               select $1, p.id from public.products p
                where p.merchant_id = $2 and p.category_id = $3
                  and p.archived_at is null and p.is_available
                order by p.position limit $4
               on conflict do nothing`,
              [promoId, m.id, cat.id, spec.products]
            );
            productCount = rowCount ?? 0;
          }
        }

        // Bannière : habille l'offre à l'accueil ET sur la fiche commerçant.
        const b = spec.banner;
        await client.query(
          `insert into public.promo_banners (
             title, subtitle, cta_label, accent, position, active,
             starts_at, ends_at, merchant_id, promotion_id,
             template, palette, illustration, show_products, image_fit
           ) values (
             $1,$2,$3,'violet',$4,true,
             now(),$5,$6,$7,
             $8,$9,'auto',$10,'overlay'
           )`,
          [
            b.title,
            b.subtitle,
            b.cta,
            (mi + 1) * 10 + oi,
            endsAt.toISOString(),
            m.id,
            promoId,
            b.template,
            b.palette,
            b.show_products === true && productCount > 0,
          ]
        );

        created.push(
          `${spec.type}${productCount ? ` (${productCount}p)` : ""}`
        );
      }

      summary.push({
        commerce: m.name,
        type: m.category,
        offres: created.length,
        détail: created.join(", "),
      });
      console.log(`  • ${m.name} — ${created.join(", ")}`);
    }

    console.table(summary);
    const { rows: totals } = await client.query(
      `select
         (select count(*) from public.promotions p join public.merchants mm on mm.id=p.merchant_id where mm.slug like 'dz-%') as promos,
         (select count(*) from public.promo_banners b join public.merchants mm on mm.id=b.merchant_id where mm.slug like 'dz-%') as bannieres,
         (select count(*) from public.promotion_products pp join public.promotions p on p.id=pp.promotion_id join public.merchants mm on mm.id=p.merchant_id where mm.slug like 'dz-%') as produits_lies`
    );
    console.log(
      `\n✅ ${totals[0].promos} promotions · ${totals[0].bannieres} bannières · ${totals[0].produits_lies} produits ciblés`
    );
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error("❌ Échec du seed promotions :", e);
  process.exit(1);
});
