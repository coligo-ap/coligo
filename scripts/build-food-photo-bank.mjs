/**
 * Banque de photos « produits préparés » (boulangerie / pâtisserie / fast-food
 * / restaurant) alimentée depuis **Wikimedia Commons**.
 *
 * Pourquoi Commons : toutes les images y sont sous licence LIBRE utilisable
 * COMMERCIALEMENT (CC0, domaine public, CC BY, CC BY-SA). On enregistre pour
 * chacune l'auteur + la licence + l'URL source dans le manifeste, puis en base
 * (merchant_image_bank), conformément à la règle « licences vérifiées ».
 *
 *   node scripts/build-food-photo-bank.mjs                 # télécharge ce qui manque
 *   node scripts/build-food-photo-bank.mjs --force         # re-télécharge tout
 *   node scripts/build-food-photo-bank.mjs --only=baklawa,tacos-poulet
 *   node scripts/build-food-photo-bank.mjs --sheets        # planches de contrôle
 *
 * Sortie : ../catalog-photos-food/<family>/<slug>.jpg + _manifest.json
 */
import { mkdirSync, writeFileSync, readFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import sharp from "sharp";
import { FOOD_ITEMS, CATEGORY_IMAGES } from "./food-photo-bank-items.mjs";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..", "..");
const OUT = join(ROOT, "catalog-photos-food");
const UA = "coligo-seed/1.0 (https://coligo.dz; contact@coligo.dz)";

const args = process.argv.slice(2);
const FORCE = args.includes("--force");
const SHEETS = args.includes("--sheets");
const ONLY = (args.find((a) => a.startsWith("--only=")) ?? "")
  .replace("--only=", "")
  .split(",")
  .filter(Boolean);

// Titres de fichiers à écarter : ce ne sont pas des photos de plat.
const TITLE_BLOCK =
  /(logo|map|carte|diagram|chart|coat of arms|stamp|timbre|poster|book|cover|sign|banner|icon|drawing|painting|illustration|cartoon|graph|plaque|label|packaging|menu|restaurant interior|shop front|storefront|street|market stall|festival|woman|man |people|chef |cooking|recipe steps|step [0-9]|ingredients|advertis|advert |lithograph|engraving|etching|woodcut|postcard|vintage|museum|gallery|portrait|us navy|uss |army|soldier|truck|factory|plant |brewery|bottling|assembly line|\b1[5-9][0-9]{2}\b)/i;

/** Score de licence : on privilégie ce qui n'exige pas d'attribution. */
function licenseScore(lic) {
  const l = (lic || "").toLowerCase();
  if (/cc0|public domain|pd-|no restrictions/.test(l)) return 3;
  if (/cc by-sa/.test(l)) return 1;
  if (/cc by/.test(l)) return 2;
  if (/gfdl|free art|fal/.test(l)) return 1;
  return -10; // licence inconnue → on refuse
}

function stripHtml(s) {
  return (s || "")
    .replace(/<[^>]*>/g, " ")
    .replace(/&[a-z]+;/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

async function commonsSearch(query, limit = 20) {
  const u = new URL("https://commons.wikimedia.org/w/api.php");
  u.searchParams.set("action", "query");
  u.searchParams.set("format", "json");
  u.searchParams.set("generator", "search");
  u.searchParams.set("gsrsearch", `${query} filetype:bitmap`);
  u.searchParams.set("gsrnamespace", "6");
  u.searchParams.set("gsrlimit", String(limit));
  u.searchParams.set("prop", "imageinfo");
  u.searchParams.set("iiprop", "url|extmetadata|size|mime");
  u.searchParams.set("iiurlwidth", "1400");
  const r = await fetch(u, { headers: { "user-agent": UA } });
  if (!r.ok) throw new Error(`Commons HTTP ${r.status}`);
  const j = await r.json();
  const pages = Object.values(j.query?.pages ?? {});
  // L'ordre de `generator=search` est perdu dans l'objet pages → on le restaure.
  pages.sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
  return pages;
}

/** Récupère UN fichier Commons par son titre exact (`file:` dans `queries`). */
async function commonsByTitle(title) {
  const u = new URL("https://commons.wikimedia.org/w/api.php");
  u.searchParams.set("action", "query");
  u.searchParams.set("format", "json");
  u.searchParams.set("titles", title);
  u.searchParams.set("prop", "imageinfo");
  u.searchParams.set("iiprop", "url|extmetadata|size|mime");
  u.searchParams.set("iiurlwidth", "1400");
  const r = await fetch(u, { headers: { "user-agent": UA } });
  const j = await r.json();
  const p = Object.values(j.query?.pages ?? {})[0];
  const ii = p?.imageinfo?.[0];
  if (!ii) throw new Error(`fichier introuvable : ${title}`);
  const meta = ii.extmetadata ?? {};
  return {
    title: p.title,
    score: 1000,
    url: ii.thumburl ?? ii.url,
    source: ii.descriptionurl,
    license: stripHtml(meta.LicenseShortName?.value ?? meta.License?.value),
    author: stripHtml(meta.Artist?.value) || "Wikimedia Commons",
    width: ii.width,
    height: ii.height,
  };
}

/** Choisit le meilleur candidat pour un item. */
async function pickPhoto(item) {
  // Choix figé à la main (vérification visuelle) : `queries: ["file:File:X.jpg"]`.
  const pinned = item.queries.find((q) => q.startsWith("file:"));
  if (pinned) return [await commonsByTitle(pinned.slice(5))];

  const seen = new Set();
  const candidates = [];
  for (let qi = 0; qi < item.queries.length; qi++) {
    let pages = [];
    try {
      pages = await commonsSearch(item.queries[qi]);
    } catch (e) {
      console.warn(`   ⚠ recherche "${item.queries[qi]}" : ${e.message}`);
      continue;
    }
    for (let pi = 0; pi < pages.length; pi++) {
      const p = pages[pi];
      const ii = p.imageinfo?.[0];
      if (!ii || seen.has(p.title)) continue;
      seen.add(p.title);
      if (!/^image\/(jpeg|png|webp)$/.test(ii.mime || "")) continue;
      if (TITLE_BLOCK.test(p.title)) continue;
      if ((ii.width ?? 0) < 700 || (ii.height ?? 0) < 500) continue;
      const meta = ii.extmetadata ?? {};
      const lic = meta.LicenseShortName?.value ?? meta.License?.value ?? "";
      const ls = licenseScore(lic);
      if (ls < 0) continue;
      // Score : pertinence de la requête (les 1res comptent double), rang dans
      // les résultats, licence, et un bonus si le titre reprend un mot-clé.
      const kw = item.queries[qi].split(/\s+/)[0].toLowerCase();
      const titleBonus = p.title.toLowerCase().includes(kw) ? 4 : 0;
      const score =
        (item.queries.length - qi) * 6 -
        pi * 0.7 +
        ls * 2 +
        titleBonus +
        Math.min(3, (ii.width ?? 0) / 1500);
      candidates.push({
        title: p.title,
        score,
        url: ii.thumburl ?? ii.url,
        source: ii.descriptionurl,
        license: stripHtml(lic),
        author: stripHtml(meta.Artist?.value) || "Wikimedia Commons",
        width: ii.width,
        height: ii.height,
      });
    }
    if (candidates.length >= 8) break;
  }
  candidates.sort((a, b) => b.score - a.score);
  return candidates;
}

async function downloadTo(url, dest, size = 900) {
  const r = await fetch(url, { headers: { "user-agent": UA } });
  if (!r.ok) throw new Error(`HTTP ${r.status}`);
  const buf = Buffer.from(await r.arrayBuffer());
  await sharp(buf)
    .resize(size, size, { fit: "cover", position: "attention" })
    .jpeg({ quality: 84, mozjpeg: true })
    .toFile(dest);
  return buf.length;
}

// =============================================================================
// PLANCHES DE CONTRÔLE (vérification visuelle)
// =============================================================================
async function buildSheets(manifest) {
  const TILE = 260;
  const COLS = 6;
  const BAND = 34;
  const groups = {};
  for (const e of manifest) (groups[e.family] ??= []).push(e);

  for (const [family, entries] of Object.entries(groups)) {
    for (let page = 0; page * 24 < entries.length; page++) {
      const slice = entries.slice(page * 24, page * 24 + 24);
      const rows = Math.ceil(slice.length / COLS);
      const W = COLS * TILE;
      const H = rows * (TILE + BAND);
      const layers = [];
      for (let i = 0; i < slice.length; i++) {
        const x = (i % COLS) * TILE;
        const y = Math.floor(i / COLS) * (TILE + BAND);
        const buf = await sharp(
          join(OUT, slice[i].family, `${slice[i].slug}.jpg`)
        )
          .resize(TILE, TILE, { fit: "cover" })
          .toBuffer();
        layers.push({ input: buf, top: y, left: x });
        const label = slice[i].slug.replace(/&/g, "+");
        const svg = `<svg width="${TILE}" height="${BAND}"><rect width="${TILE}" height="${BAND}" fill="#111"/><text x="6" y="22" font-family="sans-serif" font-size="15" fill="#fff">${label}</text></svg>`;
        layers.push({ input: Buffer.from(svg), top: y + TILE, left: x });
      }
      const dest = join(OUT, `_sheet-${family}-${page + 1}.jpg`);
      await sharp({
        create: { width: W, height: H, channels: 3, background: "#000" },
      })
        .composite(layers)
        .jpeg({ quality: 78 })
        .toFile(dest);
      console.log(`🖼  ${dest}`);
    }
  }
}

// =============================================================================
async function main() {
  mkdirSync(OUT, { recursive: true });
  const manifestPath = join(OUT, "_manifest.json");
  const manifest = existsSync(manifestPath)
    ? JSON.parse(readFileSync(manifestPath, "utf8"))
    : [];
  const bySlug = new Map(manifest.map((e) => [e.slug, e]));

  if (SHEETS) {
    await buildSheets(manifest);
    return;
  }

  const targets = [
    ...FOOD_ITEMS.map((i) => ({ ...i, kind: "product" })),
    ...CATEGORY_IMAGES.map((i) => ({
      ...i,
      kind: "category",
      family: "_categories",
    })),
  ].filter((i) => (ONLY.length ? ONLY.includes(i.slug) : true));

  let done = 0;
  let failed = 0;
  for (const item of targets) {
    const dir = join(OUT, item.family);
    mkdirSync(dir, { recursive: true });
    const dest = join(dir, `${item.slug}.jpg`);
    if (!FORCE && existsSync(dest) && bySlug.has(item.slug)) {
      done++;
      continue;
    }
    process.stdout.write(`• ${item.slug} … `);
    try {
      const cands = await pickPhoto(item);
      if (!cands.length) throw new Error("aucun candidat");
      let ok = false;
      for (const c of cands.slice(0, 3)) {
        try {
          await downloadTo(c.url, dest, item.kind === "category" ? 1200 : 900);
          const entry = {
            slug: item.slug,
            family: item.family,
            kind: item.kind,
            cat: item.cat ?? null,
            label: item.name_fr ?? item.label,
            name_ar: item.name_ar ?? null,
            price_da: item.price_da ?? null,
            commons_title: c.title,
            license: c.license,
            author: c.author,
            source: c.source,
            alternatives: cands.slice(0, 6).map((x) => ({
              title: x.title,
              url: x.url,
              license: x.license,
              author: x.author,
              source: x.source,
            })),
          };
          bySlug.set(item.slug, entry);
          console.log(`✅ ${c.title.replace("File:", "")} [${c.license}]`);
          ok = true;
          break;
        } catch (e) {
          console.log(`(échec ${c.title}: ${e.message}) `);
        }
      }
      if (!ok) throw new Error("téléchargement impossible");
      done++;
    } catch (e) {
      failed++;
      console.log(`❌ ${e.message}`);
    }
    writeFileSync(
      manifestPath,
      JSON.stringify([...bySlug.values()], null, 1),
      "utf8"
    );
  }
  console.log(`\n${done} images prêtes, ${failed} échecs → ${OUT}`);
}

main().catch((e) => {
  console.error("❌", e);
  process.exit(1);
});
