#!/usr/bin/env node
/**
 * GARDE-FOU DU DESIGN SYSTEM
 *
 * Refuse toute couleur en dur (hex, rgb/rgba, hsl) et toute valeur d'échelle
 * « magique » (rayon, taille de texte) écrite ailleurs que dans les fichiers de
 * tokens. Objectif : qu'une couleur de marque ne puisse plus JAMAIS se figer
 * dans un composant — sinon la changer redevient une chasse dans 900 fichiers.
 *
 *   node scripts/check-design-tokens.mjs          → vérifie, sort en erreur
 *   node scripts/check-design-tokens.mjs --list   → liste tout sans échouer
 *
 * Pour ajouter une couleur : elle va dans app/design-tokens.css (et, si du
 * code non-CSS en a besoin, dans lib/design/tokens.ts). Jamais dans un .tsx.
 */
import fs from "node:fs";
import path from "node:path";

const ROOTS = ["app", "components", "lib"];
const DOC = "docs/design-system.md";

/** Les DEUX seules sources de vérité : elles ont le droit de contenir des hex. */
const TOKEN_FILES = new Set([
  "app/design-tokens.css",
  "lib/design/tokens.ts",
  // Thème « mono » en évaluation : fichier de TOKENS scopé à [data-theme-mono]
  // (aucun écran de production ne le porte). Mêmes règles — les couleurs de ce
  // thème vivent ici et nulle part ailleurs.
  "app/theme-mono.css",
]);

/**
 * Exemptions justifiées — ce ne sont pas des couleurs de design :
 *  - tickets thermiques Sunmi : encre binaire noir/blanc, et le vieux WebView
 *    de ces terminaux ne résout pas `var()` de façon fiable ;
 *  - drapeaux et logos de fournisseurs : couleurs NORMATIVES, les tokeniser
 *    serait un contresens (un drapeau algérien n'est pas « vert de marque ») ;
 *  - splash natif : la couleur de raccord doit rester identique à celle
 *    déclarée côté Android, un token CSS n'y a pas accès ;
 *  - APIs natives Capacitor : exigent un littéral `#AARRGGBB`.
 * Toute nouvelle entrée ici doit être argumentée en revue.
 */
const EXEMPT = [
  /^lib[\\/]ticket[\\/]/,
  /^components[\\/]ticket[\\/]/,
  /^app[\\/]print[\\/]/,
  /^lib[\\/]native[\\/](printer|status-bar)\.ts$/,
  /^components[\\/]i18n[\\/]locale-flag\.tsx$/,
  /^components[\\/]customer[\\/]social-auth\.tsx$/,
  /^components[\\/]brand[\\/]intro-splash\.module\.css$/,
  /^components[\\/]design-system[\\/]/,
];

/** Valeurs d'échelle qui ONT un token : les réécrire en dur est une régression. */
const RADIUS_TOKENS = {
  "8px": "rounded-sm",
  "9px": "rounded-chip",
  "10px": "rounded-control",
  "11px": "rounded-control-lg",
  "12px": "rounded-md",
  "13px": "rounded-card",
  "14px": "rounded-card-lg",
  "15px": "rounded-card-xl",
  "16px": "rounded-lg",
  "18px": "rounded-sheet-lg",
  "20px": "rounded-xl",
  "22px": "rounded-sheet-xl",
  "24px": "rounded-panel",
  "26px": "rounded-panel-lg",
  "28px": "rounded-2xl",
};
const TEXT_TOKENS = {
  "9px": "text-nano",
  "9.5px": "text-nano-lg",
  "10px": "text-micro",
  "10.5px": "text-micro-lg",
  "11px": "text-caption",
  "11.5px": "text-caption-lg",
  "12px": "text-label",
  "12.5px": "text-label-lg",
  "13px": "text-body-sm",
  "13.5px": "text-body",
  "14px": "text-body-lg",
  "14.5px": "text-body-xl",
  "15px": "text-title-sm",
  "16px": "text-title",
  "17px": "text-title-lg",
  "18px": "text-heading-sm",
  "19px": "text-heading",
  "20px": "text-heading-lg",
  "21px": "text-display-sm",
  "22px": "text-display",
};

const RE_HEX = /#[0-9a-fA-F]{3,8}\b/g;
const RE_FUNC = /\b(?:rgba?|hsla?)\(\s*[\d.]+[\s,]/g;
const RE_RADIUS =
  /\brounded(?:-(?:[tlbrse]|[tb][lrse]|[xy]))?-\[([0-9.]+px)\]/g;
const RE_TEXT = /\btext-\[([0-9.]+px)\]/g;
/** Codes d'erreur React en commentaire (« #418 », « #310 ») : pas des couleurs. */
const RE_REACT_CODE = /^#\d{3}$/;

function walk(dir, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name);
    if (e.isDirectory()) {
      if (["node_modules", ".next", "android", "ios"].includes(e.name))
        continue;
      walk(p, out);
    } else if (/\.(tsx|ts|css)$/.test(e.name)) out.push(p);
  }
  return out;
}

const listOnly = process.argv.includes("--list");
const problems = [];

for (const file of ROOTS.flatMap((r) => walk(r))) {
  const rel = file.replace(/\\/g, "/");
  if (TOKEN_FILES.has(rel)) continue;
  if (EXEMPT.some((re) => re.test(file))) continue;

  const lines = fs.readFileSync(file, "utf8").split("\n");
  lines.forEach((line, i) => {
    const at = (msg) => problems.push({ rel, line: i + 1, msg });

    for (const m of line.matchAll(RE_HEX)) {
      if (RE_REACT_CODE.test(m[0])) continue;
      at(`couleur en dur ${m[0]} — utiliser un token`);
    }
    for (const m of line.matchAll(RE_FUNC)) {
      at(
        `couleur en dur ${m[0].trim()}…) — utiliser un token ou une teinte -tint`
      );
    }
    for (const m of line.matchAll(RE_RADIUS)) {
      const token = RADIUS_TOKENS[m[1]];
      if (token) at(`rayon en dur ${m[0]} — utiliser \`${token}\``);
    }
    for (const m of line.matchAll(RE_TEXT)) {
      const token = TEXT_TOKENS[m[1]];
      if (token) at(`taille en dur ${m[0]} — utiliser \`${token}\``);
    }
  });
}

const byFile = new Map();
for (const p of problems) {
  if (!byFile.has(p.rel)) byFile.set(p.rel, []);
  byFile.get(p.rel).push(p);
}

if (listOnly) {
  console.error(
    `\n${problems.length} valeur(s) en dur dans ${byFile.size} fichier(s).\n`
  );
  for (const [rel, items] of [...byFile].sort(
    (a, b) => b[1].length - a[1].length
  )) {
    console.error(`  ${rel}  (${items.length})`);
    for (const it of items.slice(0, 8)) {
      console.error(`    ${rel}:${it.line}  ${it.msg}`);
    }
    if (items.length > 8)
      console.error(`    … et ${items.length - 8} autre(s)`);
  }
  process.exit(0);
}

/**
 * CLIQUET. La reprise d'un existant de cette taille ne se fait pas d'un bloc :
 * on fige le décompte connu par fichier, et la règle devient « ça ne remonte
 * jamais ». Une valeur en dur AJOUTÉE fait échouer tout de suite ; une valeur
 * SUPPRIMÉE demande de re-figer la référence, ce qui verrouille le progrès.
 */
const BASELINE_PATH = "scripts/design-tokens-baseline.json";
const baseline = fs.existsSync(BASELINE_PATH)
  ? JSON.parse(fs.readFileSync(BASELINE_PATH, "utf8"))
  : {};

if (process.argv.includes("--update")) {
  const next = {};
  for (const [rel, items] of [...byFile].sort()) next[rel] = items.length;
  fs.writeFileSync(BASELINE_PATH, JSON.stringify(next, null, 2) + "\n");
  console.log(
    `✓ Référence mise à jour : ${problems.length} valeur(s) restantes dans ${byFile.size} fichier(s).`
  );
  process.exit(0);
}

const regressions = [];
const improvements = [];
for (const [rel, items] of byFile) {
  const allowed = baseline[rel] ?? 0;
  if (items.length > allowed) regressions.push({ rel, items, allowed });
}
for (const rel of Object.keys(baseline)) {
  const now = byFile.get(rel)?.length ?? 0;
  if (now < baseline[rel]) improvements.push({ rel, now, was: baseline[rel] });
}

if (regressions.length === 0) {
  const total = problems.length;
  console.log(
    `✓ Design system : aucune valeur en dur ajoutée (${total} restante(s) dans la reprise de l'existant).`
  );
  if (improvements.length) {
    const gain = improvements.reduce((s, i) => s + (i.was - i.now), 0);
    console.log(
      `  ${gain} valeur(s) de moins qu'à la référence — verrouille le progrès avec :\n  npm run lint:ds -- --update`
    );
  }
  process.exit(0);
}

console.error(
  `\n✗ Valeur(s) en dur AJOUTÉE(S) — le design system se contourne.\n`
);
for (const { rel, items, allowed } of regressions) {
  console.error(`  ${rel}  (${items.length}, référence : ${allowed})`);
  for (const it of items.slice(0, 8)) {
    console.error(`    ${rel}:${it.line}  ${it.msg}`);
  }
  if (items.length > 8) console.error(`    … et ${items.length - 8} autre(s)`);
}
console.error(
  `\nLes couleurs et les échelles vivent dans app/design-tokens.css` +
    `\n(miroir TypeScript : lib/design/tokens.ts pour les cartes, PDF et canvas).` +
    `\nOn modifie le TOKEN, jamais le composant — voir ${DOC}` +
    `\nVitrine visuelle : /design-system\n`
);
process.exit(1);
