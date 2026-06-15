/**
 * Import des COMMERCES nommés OSM (Algérie) dans public.geo_places.
 *
 * Complète import-osm-places-dz.mjs (qui ne prend que lieux + POI structurants)
 * avec les enseignes que les clients utilisent comme repères : restaurants,
 * cafés, fast-foods, magasins, pharmacies, stations-service, banques, salles de
 * sport… Beaucoup sont sur les cartes (OSM = source libre commune) mais étaient
 * introuvables faute d'être dans NOTRE table. Une fois importés, ils profitent
 * du matching par squelette consonantique (graphies darija) + proximité.
 *
 * Source : Overpass API (POI commerciaux nommés sur le territoire DZ).
 * Idempotent : delete/insert des seules lignes source='osm_biz' (n'affecte ni
 * GeoNames ni l'import OSM des lieux).
 *
 * Usage : node scripts/import-osm-businesses-dz.mjs
 */

import pg from "pg";
import { getDbUrl } from "./_supabase.mjs";

const OVERPASS = "https://overpass-api.de/api/interpreter";

// Enseignes grand public servant de repère. (Les lieux/POI structurants —
// hôpitaux, gares, marchés, malls — sont déjà couverts par l'autre import.)
const QUERY = `
[out:json][timeout:300];
area["ISO3166-1"="DZ"][admin_level=2]->.dz;
(
  nwr["amenity"~"^(restaurant|cafe|fast_food|bar|pub|food_court|ice_cream|pharmacy|fuel|bank|bureau_de_change|cinema|theatre|nightclub|car_rental|car_wash|driving_school)$"]["name"](area.dz);
  nwr["shop"]["name"](area.dz);
  nwr["craft"]["name"](area.dz);
  nwr["leisure"~"^(fitness_centre|sports_centre)$"]["name"](area.dz);
  nwr["tourism"="guest_house"]["name"](area.dz);
);
out center;
`;

/** Catégorie stockée dans feature_code (type d'enseigne). */
function categoryOf(t) {
  if (t.amenity) return t.amenity;
  if (t.shop) return t.shop === "yes" ? "shop" : t.shop;
  if (t.craft) return "craft";
  if (t.leisure) return t.leisure;
  if (t.tourism) return t.tourism;
  return "shop";
}

// --- Normalisation (PARITÉ avec public.geo_skeleton / import-osm-places) -----

function fold(s) {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

function skeleton(s) {
  return fold(s)
    .replace(/[^\p{L}\p{N}]/gu, "")
    .replace(/[aeiouy]/g, "")
    .replace(/(.)\1+/g, "$1");
}

function isUseful(alt) {
  return /[a-z]/i.test(alt) || /[؀-ۿ]/.test(alt);
}

async function main() {
  console.log("⬇️  Requête Overpass (commerces nommés en Algérie)…");
  const res = await fetch(OVERPASS, {
    method: "POST",
    headers: {
      "Content-Type": "application/x-www-form-urlencoded",
      "User-Agent": "Coligo/0.3 (import gazetteer; contact: dev@coligo.app)",
      Accept: "application/json",
    },
    body: "data=" + encodeURIComponent(QUERY),
  });
  if (!res.ok) throw new Error(`Overpass ${res.status}`);
  const data = await res.json();
  console.log(`   ${data.elements.length} éléments reçus.`);

  const rows = [];
  const dedupe = new Set(); // squelette principal + ~1 km (nœud vs way)
  for (const el of data.elements) {
    const t = el.tags ?? {};
    const name = t["name:fr"] || t.name;
    const lat = Number.isFinite(el.lat) ? el.lat : el.center?.lat;
    const lon = Number.isFinite(el.lon) ? el.lon : el.center?.lon;
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    const variants = [
      ...new Set(
        [
          t.name,
          t["name:fr"],
          t["name:ar"],
          t["name:kab"],
          t.brand,
          t.alt_name,
          t["alt_name:fr"],
          t.old_name,
          t.short_name,
          t.official_name,
        ]
          .flatMap((v) => (v ? v.split(";") : []))
          .map((v) => v.trim())
          .filter((v) => v && isUseful(v))
      ),
    ];
    if (variants.length === 0) continue;

    const skels = [
      ...new Set(variants.map(skeleton).filter((s) => s.length >= 3)),
    ];
    const key = `${skels[0] ?? fold(name)}|${lat.toFixed(2)}|${lon.toFixed(2)}`;
    if (dedupe.has(key)) continue;
    dedupe.add(key);

    rows.push({
      name,
      lat,
      lng: lon,
      feature_code: categoryOf(t),
      search_text: [...new Set(variants.map(fold))].join(" "),
      skel: skels.join("|"),
    });
  }
  console.log(`🏪 ${rows.length} commerces OSM retenus.`);
  if (rows.length === 0) {
    console.log("Rien à importer.");
    return;
  }

  const client = new pg.Client({ connectionString: getDbUrl() });
  await client.connect();
  try {
    await client.query("BEGIN");
    const del = await client.query(
      "DELETE FROM public.geo_places WHERE source = 'osm_biz'"
    );
    console.log(`🧹 ${del.rowCount} anciennes lignes commerces supprimées.`);

    const BATCH = 500;
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH);
      const values = [];
      const params = [];
      chunk.forEach((r, j) => {
        const o = j * 6;
        values.push(
          `($${o + 1},$${o + 2},$${o + 3},$${o + 4},0,$${o + 5},$${o + 6},'osm_biz')`
        );
        params.push(
          r.name,
          r.lat,
          r.lng,
          r.feature_code,
          r.search_text,
          r.skel
        );
      });
      await client.query(
        `INSERT INTO public.geo_places
           (name, lat, lng, feature_code, population, search_text, skel, source)
         VALUES ${values.join(",")}`,
        params
      );
    }

    // Wilaya héritée du lieu GeoNames le plus proche (<40 km).
    console.log("🗺️  Attribution des wilayas (plus proche voisin GeoNames)…");
    await client.query(`
      UPDATE public.geo_places o
      SET wilaya = (
        SELECT g.wilaya FROM public.geo_places g
        WHERE g.source = 'geonames' AND g.wilaya IS NOT NULL
          AND abs(g.lat - o.lat) < 0.4 AND abs(g.lng - o.lng) < 0.45
        ORDER BY power((g.lat - o.lat) * 111, 2) + power((g.lng - o.lng) * 93, 2)
        LIMIT 1
      )
      WHERE o.source = 'osm_biz'
    `);

    await client.query("COMMIT");
    const {
      rows: [{ n, w }],
    } = await client.query(
      `SELECT count(*)::int AS n,
              count(*) FILTER (WHERE wilaya IS NOT NULL)::int AS w
       FROM public.geo_places WHERE source = 'osm_biz'`
    );
    console.log(
      `✅ Import commerces terminé — ${n} enseignes (${w} avec wilaya).`
    );
  } catch (e) {
    await client.query("ROLLBACK").catch(() => {});
    throw e;
  } finally {
    await client.end();
  }
}

main().catch((e) => {
  console.error("❌", e.message);
  process.exit(1);
});
