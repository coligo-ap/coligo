// =============================================================================
// Élagage des binaires onnxruntime-node inutiles AVANT `next build`, sur
// Vercel UNIQUEMENT (env VERCEL=1). Le paquet livre 259 Mo de binaires toutes
// plateformes ; la fonction /api/idv/* dépassait la limite de 250 Mo
// (338,89 Mo, build en échec) car `outputFileTracingExcludes` est ignoré pour
// les paquets externalisés. Vercel exécute du linux x64 : on supprime le
// reste du disque — le traçage n'a alors plus rien d'autre à embarquer.
// En local (Windows/macOS), on ne touche à RIEN.
// =============================================================================
import { existsSync, rmSync } from "node:fs";
import { join } from "node:path";

if (process.env.VERCEL !== "1") {
  console.log("prune-onnx: hors Vercel, aucun élagage.");
  process.exit(0);
}

const bin = join(
  process.cwd(),
  "node_modules",
  "onnxruntime-node",
  "bin",
  "napi-v6"
);
let pruned = 0;
for (const dir of ["darwin", "win32", join("linux", "arm64")]) {
  const target = join(bin, dir);
  if (existsSync(target)) {
    rmSync(target, { recursive: true, force: true });
    console.log(`prune-onnx: supprimé ${dir}`);
    pruned++;
  }
}
console.log(
  pruned
    ? `prune-onnx: ${pruned} plateforme(s) élaguée(s) — il ne reste que linux/x64.`
    : "prune-onnx: rien à élaguer (déjà propre)."
);
