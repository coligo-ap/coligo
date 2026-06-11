/**
 * Import du gazetteer GeoNames Algérie dans public.geo_places (mig 0152).
 *
 * Source : https://download.geonames.org/export/dump/DZ.zip (CC-BY 4.0).
 * On garde les lieux peuplés (classe P : villes, villages, hameaux) et les
 * lieux-dits (L.LCTY) — ce sont eux que les clients tapent dans la recherche
 * d'adresse (« Lekhmisse », « Ighil Ali »…).
 *
 * Pour chaque lieu on indexe :
 *   - search_text : nom + asciiname + noms alternatifs latin/arabe, normalisés
 *     (minuscules sans accents) → matching trigram (fautes de frappe) ;
 *   - skel : « squelette consonantique » de chaque variante (voyelles,
 *     espaces, apostrophes retirées ; répétitions collapsées ; entrées
 *     séparées par |) → variantes de translittération (lekhmisse ≈ el khemis).
 *
 * Idempotent : supprime puis ré-insère uniquement les lignes geoname_id IS NOT
 * NULL — les ajouts manuels (geoname_id NULL) sont préservés.
 *
 * Usage : node scripts/import-geonames-dz.mjs
 */

import { execSync } from "node:child_process";
import { readFileSync, mkdtempSync, rmSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import pg from "pg";
import { getDbUrl } from "./_supabase.mjs";

const DUMP_URL = "https://download.geonames.org/export/dump/DZ.zip";
const ADMIN1_URL =
  "https://download.geonames.org/export/dump/admin1CodesASCII.txt";

// --- Normalisation (PARITÉ avec public.geo_skeleton de la mig 0152) ---------

/** Minuscules sans accents (équivalent f_unaccent(lower(x))). */
function fold(s) {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "");
}

/** Squelette : lettres/chiffres seuls → sans voyelles latines → sans doublons. */
function skeleton(s) {
  return fold(s)
    .replace(/[^\p{L}\p{N}]/gu, "")
    .replace(/[aeiouy]/g, "")
    .replace(/(.)\1+/g, "$1");
}

/** Variante latin/arabe utile (écarte cyrillique, chinois, codes IATA…). */
function isUseful(alt) {
  return /[a-z]/i.test(alt) || /[؀-ۿ]/.test(alt);
}

// --- Téléchargement ----------------------------------------------------------

async function main() {
  const tmp = mkdtempSync(join(tmpdir(), "geonames-dz-"));
  try {
    console.log("⬇️  Téléchargement DZ.zip + admin1CodesASCII.txt…");
    execSync(`curl -sSL -o "${join(tmp, "DZ.zip")}" ${DUMP_URL}`, {
      stdio: "inherit",
    });
    // tar de Windows 10+ (bsdtar) sait extraire les .zip
    execSync(`tar -xf "${join(tmp, "DZ.zip")}" -C "${tmp}"`, {
      stdio: "inherit",
    });
    const dzPath = join(tmp, "DZ.txt");
    if (!existsSync(dzPath))
      throw new Error("DZ.txt introuvable après extraction");

    const admin1Raw = await (await fetch(ADMIN1_URL)).text();
    const wilayas = new Map(); // "DZ.XX" -> nom de wilaya
    for (const line of admin1Raw.split("\n")) {
      if (!line.startsWith("DZ.")) continue;
      const [code, name] = line.split("\t");
      wilayas.set(code, name);
    }
    console.log(`   ${wilayas.size} wilayas mappées.`);

    // --- Parsing -------------------------------------------------------------
    const rows = [];
    for (const line of readFileSync(dzPath, "utf8").split("\n")) {
      const f = line.split("\t");
      if (f.length < 15) continue;
      const [gid, name, asciiname, altRaw, lat, lng, fclass, fcode] = f;
      const keep = fclass === "P" || (fclass === "L" && fcode === "LCTY");
      if (!keep) continue;

      const alts = (altRaw || "")
        .split(",")
        .map((a) => a.trim())
        .filter((a) => a && isUseful(a));
      const variants = [...new Set([name, asciiname, ...alts].filter(Boolean))];

      const searchText = [...new Set(variants.map(fold))].join(" ");
      const skel = [
        ...new Set(variants.map(skeleton).filter((s) => s.length >= 3)),
      ].join("|");

      rows.push({
        geoname_id: Number(gid),
        name,
        wilaya: wilayas.get(`DZ.${f[10]}`) ?? null,
        lat: Number(lat),
        lng: Number(lng),
        feature_code: fcode || null,
        population: Number(f[14]) || 0,
        search_text: searchText,
        skel,
      });
    }
    console.log(`📍 ${rows.length} lieux retenus (P + LCTY).`);

    // --- Insertion -------------------------------------------------------------
    const client = new pg.Client({ connectionString: getDbUrl() });
    await client.connect();
    try {
      await client.query("BEGIN");
      const del = await client.query(
        "DELETE FROM public.geo_places WHERE geoname_id IS NOT NULL"
      );
      console.log(`🧹 ${del.rowCount} anciennes lignes GeoNames supprimées.`);

      const BATCH = 500;
      for (let i = 0; i < rows.length; i += BATCH) {
        const chunk = rows.slice(i, i + BATCH);
        const values = [];
        const params = [];
        chunk.forEach((r, j) => {
          const o = j * 9;
          values.push(
            `($${o + 1},$${o + 2},$${o + 3},$${o + 4},$${o + 5},$${o + 6},$${o + 7},$${o + 8},$${o + 9})`
          );
          params.push(
            r.geoname_id,
            r.name,
            r.wilaya,
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
             (geoname_id, name, wilaya, lat, lng, feature_code, population, search_text, skel)
           VALUES ${values.join(",")}`,
          params
        );
      }
      await client.query("COMMIT");

      const {
        rows: [{ n }],
      } = await client.query(
        "SELECT count(*)::int AS n FROM public.geo_places"
      );
      console.log(`✅ Import terminé — ${n} lieux en base.`);
    } catch (e) {
      await client.query("ROLLBACK").catch(() => {});
      throw e;
    } finally {
      await client.end();
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
}

main().catch((e) => {
  console.error("❌", e.message);
  process.exit(1);
});
