// =============================================================================
// GARDE-FOU anti-fuite RLS multi-locataire (statique, sans DB).
// -----------------------------------------------------------------------------
// Contexte : plusieurs tables servent la VITRINE CLIENT et ont donc une policy
// SELECT PUBLIQUE (`products_select_public_active`, `categories_select_public`,
// `promotions_select_public_active`, options…). Comme les policies RLS
// permissives s'additionnent en OR, une session commerçant voit TOUJOURS
// « ses lignes OR toutes les lignes publiques » → la RLS NE PEUT PAS isoler par
// commerçant sur ces tables. Le filtrage `.eq("merchant_id", …)` applicatif est
// donc OBLIGATOIRE. Ce piège a fui plusieurs fois (commits 8819cba, d1f83de).
//
// Ce test verrouille l'invariant : dans la SURFACE COMMERÇANT (app/(merchant),
// lib/data/catalog.ts, lib/data/promotions.ts, lib/ticket), toute LECTURE
// (`.from(table).select(...)`) d'une de ces tables publiques DOIT contenir
// `merchant_id` dans sa requête. Sinon → échec.
//
// Échappatoire explicite (auditée) pour un cas légitime non filtrable ainsi
// (ex. propriété vérifiée par une requête voisine) : ajouter un commentaire
//   // tenant-scope-ok: <raison>
// sur/au-dessus de la ligne `.from(...)`. Volontairement visible et greppable.
//
// Exécution : node scripts/test-tenant-scope.mjs
// =============================================================================
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");

// Tables ayant une policy SELECT publique (cf. migrations 0004/0016/0027/0262).
const PUBLIC_TABLES = new Set([
  "products",
  "categories",
  "promotions",
  "promotion_products",
  "product_option_groups",
  "product_options",
  "reviews",
]);

// Surface où l'invariant « lecture publique ⇒ .eq(merchant_id) » s'applique.
// (La vitrine CLIENT lit volontairement plusieurs commerces → hors périmètre.)
const SCAN_TARGETS = [
  "app/(merchant)",
  "lib/data/catalog.ts",
  "lib/data/promotions.ts",
  "lib/ticket",
];

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

/** Liste récursive des fichiers .ts/.tsx sous un chemin (fichier ou dossier). */
function collect(target) {
  const abs = join(ROOT, target);
  let st;
  try {
    st = statSync(abs);
  } catch {
    return [];
  }
  if (st.isFile()) return /\.(ts|tsx)$/.test(abs) ? [abs] : [];
  const out = [];
  for (const name of readdirSync(abs)) {
    if (name === "node_modules" || name === ".next") continue;
    out.push(...collect(join(target, name)));
  }
  return out;
}

const files = [...new Set(SCAN_TARGETS.flatMap(collect))];

const FROM_RE = /\.from\(\s*["'](\w+)["']\s*\)/g;
const violations = [];
let readsChecked = 0;

for (const file of files) {
  const src = readFileSync(file, "utf8");
  for (const m of src.matchAll(FROM_RE)) {
    const table = m[1];
    if (!PUBLIC_TABLES.has(table)) continue;

    // Exclure le Storage : supabase.storage.from("products").upload(...).
    if (src.slice(Math.max(0, m.index - 40), m.index).includes(".storage"))
      continue;

    // Méthode enchaînée juste après `.from(...)` : seul `.select` = LECTURE.
    // insert/update/delete/upsert = écriture, bornée par les policies _own
    // WITH CHECK → hors périmètre de ce test.
    const after = src.slice(m.index + m[0].length);
    const nextMethod = after.match(/^\s*\.(\w+)/);
    if (!nextMethod || nextMethod[1] !== "select") continue;

    readsChecked++;

    // Span de la requête : du `.from(` jusqu'au prochain `.from(` (requête
    // sœur d'un Promise.all) ou `;` — au plus tôt. Isole la chaîne courante.
    const restIdx = m.index + m[0].length;
    const nextFrom = src.indexOf(".from(", restIdx);
    const nextSemi = src.indexOf(";", restIdx);
    const candidates = [nextFrom, nextSemi, m.index + 700].filter((i) => i > 0);
    const spanEnd = Math.min(...candidates);
    const span = src.slice(m.index, spanEnd);
    // Fenêtre incluant un bloc de commentaire de quelques lignes au-dessus pour
    // l'échappatoire `tenant-scope-ok` (token rare et délibéré → pas de masquage
    // fortuit d'une vraie violation).
    const markerWindow = src.slice(Math.max(0, m.index - 360), spanEnd);

    const scoped = span.includes("merchant_id");
    const optedOut = markerWindow.includes("tenant-scope-ok");
    if (scoped || optedOut) continue;

    const line = src.slice(0, m.index).split("\n").length;
    violations.push(
      `${file.replace(ROOT + "\\", "").replace(ROOT + "/", "")}:${line} — .from("${table}").select(...) sans .eq("merchant_id")`
    );
  }
}

console.log(
  `\nGarde-fou tenant-scope — ${files.length} fichiers scannés, ${readsChecked} lectures de tables publiques contrôlées :\n`
);

ok(
  violations.length === 0,
  violations.length === 0
    ? "Toutes les lectures de tables publiques (surface commerçant) sont scellées par merchant_id"
    : `${violations.length} lecture(s) non scellée(s) :\n     - ${violations.join("\n     - ")}\n\n   Corrige avec .eq(\"merchant_id\", …) ou, si légitime, ajoute\n   « // tenant-scope-ok: <raison> » au-dessus du .from(...).`
);

// Sanity : le test doit VOIR des lectures (sinon le scan est cassé / mal ciblé).
ok(readsChecked > 0, `Le scan a bien inspecté des lectures (${readsChecked})`);

console.log(`\n${pass} ✅  ${fail} ❌\n`);
process.exit(fail > 0 ? 1 : 0);
