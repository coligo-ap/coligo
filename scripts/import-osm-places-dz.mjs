/**
 * Import des lieux nommés OSM (Algérie) dans public.geo_places (mig 0152/0154).
 *
 * Complète GeoNames : beaucoup de lieux-dits/quartiers algériens n'existent
 * que dans OSM (ex. « Souq el Khémis » à Bouhamza, Béjaïa). En les important
 * dans NOTRE table, le matching par squelette consonantique (lekhmisse ≈
 * souq el khemis) s'applique aussi à eux — ce que Photon/Nominatim ne savent
 * pas faire.
 *
 * Source : Overpass API (nœuds place=* avec un nom, sur le territoire DZ).
 * Idempotent : delete/insert des seules lignes source='osm'. Après insertion :
 *   - wilaya héritée du lieu GeoNames le plus proche (<40 km) ;
 *   - doublons évidents de GeoNames retirés (même squelette à <3 km).
 *
 * Usage : node scripts/import-osm-places-dz.mjs
 */

import pg from "pg";
import { getDbUrl } from "./_supabase.mjs";

const OVERPASS = "https://overpass-api.de/api/interpreter";
// Localités + POI structurants : les clients donnent souvent un repère connu
// (« Place Gueydon », « gare de Béjaïa », « stade ») plutôt qu'une adresse.
const QUERY = `
[out:json][timeout:300];
area["ISO3166-1"="DZ"][admin_level=2]->.dz;
(
  node["place"~"^(city|town|village|hamlet|suburb|quarter|neighbourhood|locality|isolated_dwelling|square)$"]["name"](area.dz);
  way["place"="square"]["name"](area.dz);
  nwr["amenity"~"^(hospital|clinic|university|college|bus_station|marketplace|townhall|place_of_worship)$"]["name"](area.dz);
  nwr["railway"="station"]["name"](area.dz);
  nwr["aeroway"~"^(aerodrome|terminal)$"]["name"](area.dz);
  nwr["tourism"~"^(attraction|museum|hotel|zoo|theme_park)$"]["name"](area.dz);
  nwr["leisure"~"^(park|stadium|beach_resort)$"]["name"](area.dz);
  nwr["natural"="beach"]["name"](area.dz);
  nwr["historic"]["name"](area.dz);
  nwr["shop"="mall"]["name"](area.dz);
);
out center;
`;

/** Catégorie stockée dans feature_code (sert au bonus POI du RPC). */
function categoryOf(t) {
  if (t.place) return t.place;
  if (t.railway === "station") return "station";
  if (t.aeroway) return "aerodrome";
  if (t.amenity) return t.amenity;
  if (t.leisure === "stadium") return "stadium";
  if (t.leisure) return t.leisure;
  if (t.tourism) return t.tourism;
  if (t.natural === "beach") return "beach";
  if (t.shop === "mall") return "mall";
  if (t.historic) return "historic";
  return null;
}

// --- Normalisation (PARITÉ avec public.geo_skeleton / import-geonames) ------

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
  console.log("⬇️  Requête Overpass (nœuds place=* en Algérie)…");
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
  console.log(`   ${data.elements.length} nœuds reçus.`);

  const rows = [];
  const dedupe = new Set(); // squelette principal + ~1 km (nœud vs way du même lieu)
  for (const el of data.elements) {
    const t = el.tags ?? {};
    const name = t["name:fr"] || t.name;
    const lat = Number.isFinite(el.lat) ? el.lat : el.center?.lat;
    const lon = Number.isFinite(el.lon) ? el.lon : el.center?.lon;
    if (!name || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;

    // Tous les noms connus, dont les ANCIENS (« Place Gueydon » → renommée
    // « Place du 1er Novembre 1954 » : les habitants utilisent l'ancien nom).
    const variants = [
      ...new Set(
        [
          t.name,
          t["name:fr"],
          t["name:ar"],
          t["name:kab"],
          t.alt_name,
          t["alt_name:fr"],
          t.old_name,
          t["old_name:fr"],
          t.loc_name,
          t.short_name,
          t.official_name,
          t.int_name,
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
      population: Number(t.population) || 0,
      search_text: [...new Set(variants.map(fold))].join(" "),
      skel: skels.join("|"),
    });
  }
  console.log(`📍 ${rows.length} lieux OSM retenus.`);

  const client = new pg.Client({ connectionString: getDbUrl() });
  await client.connect();
  try {
    await client.query("BEGIN");
    const del = await client.query(
      "DELETE FROM public.geo_places WHERE source = 'osm'"
    );
    console.log(`🧹 ${del.rowCount} anciennes lignes OSM supprimées.`);

    const BATCH = 500;
    for (let i = 0; i < rows.length; i += BATCH) {
      const chunk = rows.slice(i, i + BATCH);
      const values = [];
      const params = [];
      chunk.forEach((r, j) => {
        const o = j * 7;
        values.push(
          `($${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5},$${o + 6},$${o + 7},'osm')`
        );
        params.push(
          r.name,
          r.lat,
          r.lng,
          r.feature_code,
          r.population,
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

    // Wilaya héritée du lieu GeoNames le plus proche (<40 km, approximation
    // plate suffisante pour de l'affichage/désambiguïsation).
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
      WHERE o.source = 'osm'
    `);

    // Doublons GeoNames évidents : même squelette principal à moins de ~3 km.
    const dedup = await client.query(`
      DELETE FROM public.geo_places o
      WHERE o.source = 'osm'
        AND EXISTS (
          SELECT 1 FROM public.geo_places g
          WHERE g.source = 'geonames'
            AND abs(g.lat - o.lat) < 0.03 AND abs(g.lng - o.lng) < 0.035
            AND split_part(g.skel, '|', 1) = split_part(o.skel, '|', 1)
        )
    `);
    console.log(`🧹 ${dedup.rowCount} doublons OSM/GeoNames retirés.`);

    await client.query("COMMIT");
    const {
      rows: [{ n, w }],
    } = await client.query(
      `SELECT count(*)::int AS n,
              count(*) FILTER (WHERE wilaya IS NOT NULL)::int AS w
       FROM public.geo_places WHERE source = 'osm'`
    );
    console.log(`✅ Import OSM terminé — ${n} lieux (${w} avec wilaya).`);
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
