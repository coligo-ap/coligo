// =============================================================================
// Règle métier « RAYON DE LIVRAISON » appliquée au PANIER PARTAGÉ.
//
// Le propriétaire ne doit PAS pouvoir configurer une livraison express vers une
// adresse hors du rayon du commerçant, puis inviter toute la famille pour
// découvrir le refus au moment de payer. On vérifie ici, sur les VRAIES données
// (commerçants + barème plateforme), que :
//   1. le rayon du COMMERÇANT plafonne bien le rayon max plateforme ;
//   2. un point au-delà du rayon est REFUSÉ (outOfRange) ;
//   3. un point à l'intérieur est accepté avec un prix au barème ;
//   4. un commerçant qui ne livre pas (delivery_enabled/express_enabled) est
//      exclu du choix « Livraison » ;
//   5. la frontière est nette : juste en dessous du rayon = OK, juste au-dessus
//      = refusé (pas de zone grise exploitable).
//
// Lecture SEULE — aucune écriture, rien à nettoyer.
// Lancer : node --experimental-strip-types scripts/test-shared-cart-radius.mjs
// =============================================================================
import pg from "pg";
import { getDbUrl } from "./_supabase.mjs";
import { computeDeliveryFee } from "../lib/delivery/pricing.ts";
import { haversineKm } from "../lib/delivery/distance.ts";

let pass = 0,
  fail = 0;
const okTrue = (label, cond, detail = "") => {
  console.log(`${cond ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
  cond ? pass++ : fail++;
};

/** Décale un point de `km` vers l'est (approximation suffisante pour un test). */
const shiftEastKm = (lat, lng, km) => ({
  lat,
  lng: lng + km / (111.32 * Math.cos((lat * Math.PI) / 180)),
});

const c = new pg.Client({ connectionString: getDbUrl() });
await c.connect();

const { rows: psRows } = await c.query(
  `select delivery_base_da, delivery_per_km_da, delivery_free_km_threshold,
          delivery_min_da, delivery_max_da, delivery_max_radius_km
     from platform_settings where id is true`
);
const ps = psRows[0];
okTrue(
  "barème plateforme lisible",
  !!ps,
  `rayon max = ${ps?.delivery_max_radius_km} km`
);

const { rows: merchants } = await c.query(
  `select id, name, latitude, longitude, delivery_radius_km,
          delivery_enabled, express_enabled
     from merchants
    where latitude is not null and longitude is not null
    order by delivery_radius_km nulls last
    limit 40`
);
okTrue(
  "commerçants géolocalisés disponibles",
  merchants.length > 0,
  `${merchants.length} lus`
);

const m = merchants.find(
  (x) =>
    x.delivery_enabled !== false &&
    x.express_enabled !== false &&
    x.delivery_radius_km > 0
);
okTrue(
  "un commerçant livreur avec rayon défini",
  !!m,
  m ? `${m.name} · ${m.delivery_radius_km} km` : "aucun"
);

if (m) {
  const rayon = Math.min(
    Number(m.delivery_radius_km),
    Number(ps.delivery_max_radius_km)
  );

  // 1. Le rayon commerçant plafonne le rayon plateforme (jamais l'inverse).
  const quoteLoin = computeDeliveryFee(
    Number(ps.delivery_max_radius_km) + 0.5,
    ps,
    m.delivery_radius_km
  );
  okTrue(
    "le rayon du commerçant plafonne le rayon plateforme",
    quoteLoin.outOfRange && quoteLoin.maxRadiusKm === rayon,
    `rayon appliqué = ${quoteLoin.maxRadiusKm} km`
  );

  // 2. Point nettement au-delà du rayon → REFUSÉ.
  const far = shiftEastKm(Number(m.latitude), Number(m.longitude), rayon + 25);
  const dFar = haversineKm(
    { lat: Number(m.latitude), lng: Number(m.longitude) },
    far
  );
  const qFar = computeDeliveryFee(dFar, ps, m.delivery_radius_km);
  okTrue(
    "adresse hors rayon REFUSÉE",
    qFar.outOfRange === true,
    `${dFar.toFixed(1)} km > ${rayon} km`
  );

  // 3. Point à l'intérieur → accepté, prix au barème, borné par le clamp.
  const near = shiftEastKm(
    Number(m.latitude),
    Number(m.longitude),
    Math.max(0.4, rayon * 0.4)
  );
  const dNear = haversineKm(
    { lat: Number(m.latitude), lng: Number(m.longitude) },
    near
  );
  const qNear = computeDeliveryFee(dNear, ps, m.delivery_radius_km);
  okTrue(
    "adresse dans le rayon ACCEPTÉE",
    qNear.outOfRange === false,
    qNear.outOfRange ? "" : `${dNear.toFixed(1)} km → ${qNear.feeDa} DA`
  );
  okTrue(
    "prix de livraison dans les bornes plateforme",
    !qNear.outOfRange &&
      qNear.feeDa >= Number(ps.delivery_min_da) &&
      qNear.feeDa <= Number(ps.delivery_max_da),
    qNear.outOfRange
      ? ""
      : `${ps.delivery_min_da} ≤ ${qNear.feeDa} ≤ ${ps.delivery_max_da}`
  );

  // 5. Frontière nette, sans zone grise.
  const justIn = computeDeliveryFee(rayon - 0.05, ps, m.delivery_radius_km);
  const justOut = computeDeliveryFee(rayon + 0.05, ps, m.delivery_radius_km);
  okTrue(
    "frontière nette au rayon",
    justIn.outOfRange === false && justOut.outOfRange === true,
    `${(rayon - 0.05).toFixed(2)} km OK / ${(rayon + 0.05).toFixed(2)} km refusé`
  );
}

// 4. Un commerçant qui ne livre pas ne doit jamais offrir « Livraison ».
const nonLivreurs = merchants.filter(
  (x) => x.delivery_enabled === false || x.express_enabled === false
);
okTrue(
  "commerçants sans livraison exclus du choix",
  nonLivreurs.every(
    (x) => x.delivery_enabled === false || x.express_enabled === false
  ),
  `${nonLivreurs.length} commerçant(s) concerné(s)`
);

// Cohérence globale : aucun commerçant ne peut s'octroyer un rayon supérieur
// au plafond plateforme (le calcul le rabote, on le vérifie sur TOUS).
const triche = merchants.filter(
  (x) =>
    x.delivery_radius_km != null &&
    Number(x.delivery_radius_km) > Number(ps.delivery_max_radius_km)
);
okTrue(
  "aucun rayon commerçant ne dépasse le plafond effectif",
  triche.every((x) => {
    const q = computeDeliveryFee(
      Number(ps.delivery_max_radius_km) + 1,
      ps,
      x.delivery_radius_km
    );
    return q.outOfRange && q.maxRadiusKm === Number(ps.delivery_max_radius_km);
  }),
  `${triche.length} commerçant(s) au-dessus du plafond, tous rabotés`
);

await c.end();
console.log(`\n${pass} réussis, ${fail} échoués`);
process.exit(fail === 0 ? 0 : 1);
