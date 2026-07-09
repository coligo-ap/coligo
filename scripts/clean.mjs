#!/usr/bin/env node
/**
 * Vide les caches et artefacts régénérables du projet, et arrête les daemons
 * Gradle/Kotlin restés en mémoire.
 *
 * La machine de dev n'a que 8 Go de RAM : un daemon Gradle oublié réserve à lui
 * seul ~1 Go, et le build Android meurt alors sur un `malloc` (cf. les plafonds
 * mémoire posés dans `android/gradle.properties`).
 *
 * Rien de ce qui est supprimé ici n'est versionné : tout se régénère au prochain
 * `npm run build` / `cap sync` / build Android.
 *
 *   npm run clean
 */

import { execFileSync } from "node:child_process";
import { readdirSync, rmSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

/** Artefacts régénérables, du plus lourd au plus léger. */
const TARGETS = [
  "android/app/build",
  "android/.gradle",
  "android/build",
  ".next",
  "playwright-shots",
  "tsconfig.tsbuildinfo",
];

function sizeOf(path) {
  let total = 0;
  let stat;
  try {
    stat = statSync(path);
  } catch {
    return null;
  }
  if (stat.isFile()) return stat.size;
  for (const entry of readdirSync(path, { withFileTypes: true })) {
    const child = join(path, entry.name);
    const sub = entry.isDirectory() ? sizeOf(child) : statSync(child).size;
    total += sub ?? 0;
  }
  return total;
}

const mb = (bytes) => (bytes / 1024 / 1024).toFixed(1).padStart(7);

// Les daemons tiennent des verrous sur android/.gradle : les arrêter d'abord.
// Sous Windows le wrapper doit être appelé par CHEMIN ABSOLU et via le shell :
// depuis Node 20, execFile refuse de lancer un `.bat` directement, et le shell
// ne résout pas `gradlew.bat` depuis `cwd`.
const isWindows = process.platform === "win32";
const wrapper = join(ROOT, "android", isWindows ? "gradlew.bat" : "gradlew");
try {
  execFileSync(wrapper, ["--stop"], {
    cwd: join(ROOT, "android"),
    stdio: "ignore",
    shell: isWindows,
  });
  console.log("daemons Gradle/Kotlin arrêtés");
} catch {
  console.log("aucun daemon Gradle à arrêter");
}

let freed = 0;
for (const target of TARGETS) {
  const path = join(ROOT, target);
  const size = sizeOf(path);
  if (size === null) {
    console.log(`   absent  ${target}`);
    continue;
  }
  rmSync(path, { recursive: true, force: true });
  freed += size;
  console.log(`${mb(size)} Mo  ${target}`);
}

console.log(`\n${mb(freed)} Mo libérés.`);
