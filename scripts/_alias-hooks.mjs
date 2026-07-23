// =============================================================================
// Résolution de l'alias « @/ » pour les scripts Node (--experimental-strip-types).
//
// POURQUOI. Node ne connaît pas les alias de tsconfig : `import "@/lib/idv/…"`
// explose en ERR_MODULE_NOT_FOUND. Jusqu'ici les bancs contournaient en
// RECOPIANT le code de production dans le script de test — un banc qui teste une
// copie ne teste rien : le jour où la production change, la copie continue de
// passer au vert. Ce hook fait pointer « @/ » sur la racine du projet, comme
// Next : les bancs importent alors le VRAI module.
//
// Usage : node --experimental-strip-types --import ./scripts/_alias.mjs <script>
// =============================================================================
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";

const ROOT = new URL("../", import.meta.url);

/** Candidats testés dans l'ordre (fichier direct, puis .ts/.tsx, puis index). */
function candidates(path) {
  return /\.(ts|tsx|mjs|js|json)$/.test(path)
    ? [path]
    : [`${path}.ts`, `${path}.tsx`, `${path}/index.ts`, `${path}.js`];
}

export async function resolve(specifier, context, next) {
  if (!specifier.startsWith("@/")) return next(specifier, context);
  const base = new URL(specifier.slice(2), ROOT);
  for (const candidate of candidates(base.href)) {
    if (existsSync(fileURLToPath(candidate))) {
      return next(candidate, context);
    }
  }
  return next(specifier, context);
}
