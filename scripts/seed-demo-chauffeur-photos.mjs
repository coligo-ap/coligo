#!/usr/bin/env node
/**
 * Photos de visage des CHAUFFEURS DE DÉMO (Coligo Drive).
 *
 *   node scripts/seed-demo-chauffeur-photos.mjs
 *
 * Télécharge des portraits libres (randomuser.me) assortis au SEXE de chaque
 * chauffeur démo (is_demo), avec des visages tous différents, les upload dans
 * le bucket privé `driver-docs` (chauffeur/{id}/selfie-demo.jpg) puis renseigne
 * `chauffeurs.selfie_url` — même chemin que les vrais selfies, donc l'app les
 * signe/affiche exactement pareil. Idempotent (ré-écrase la même photo).
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import { createClient } from "@supabase/supabase-js";

const ROOT = join(dirname(fileURLToPath(import.meta.url)), "..");
function loadEnvLocal() {
  let content;
  try {
    content = readFileSync(join(ROOT, ".env.local"), "utf8");
  } catch {
    return;
  }
  for (const line of content.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*?)\s*$/);
    if (!m) continue;
    let val = m[2];
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    )
      val = val.slice(1, -1);
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
}
loadEnvLocal();

const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) {
  console.error(
    "❌ NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY manquants."
  );
  process.exit(1);
}
const supabase = createClient(url, key);

// Indices de portraits randomuser — visages variés (âges/types différents).
const MEN = [32, 75, 11, 56, 22, 83, 45, 8, 64, 90];
const WOMEN = [44, 68, 12, 26, 57, 90, 33, 5];

const { data: chs, error } = await supabase
  .from("chauffeurs")
  .select("id, first_name, full_name, is_female, gamme")
  .eq("is_demo", true)
  .order("phone");
if (error) {
  console.error("❌ Lecture chauffeurs :", error.message);
  process.exit(1);
}

let m = 0;
let w = 0;
for (const ch of chs ?? []) {
  const idx = ch.is_female ? WOMEN[w++ % WOMEN.length] : MEN[m++ % MEN.length];
  const src = `https://randomuser.me/api/portraits/${ch.is_female ? "women" : "men"}/${idx}.jpg`;
  const res = await fetch(src);
  if (!res.ok) {
    console.error(
      `  ✗ ${ch.full_name} : téléchargement échoué (${res.status})`
    );
    continue;
  }
  const buf = Buffer.from(await res.arrayBuffer());
  const path = `chauffeur/${ch.id}/selfie-demo.jpg`;
  const { error: upErr } = await supabase.storage
    .from("driver-docs")
    .upload(path, buf, { contentType: "image/jpeg", upsert: true });
  if (upErr) {
    console.error(`  ✗ ${ch.full_name} : upload échoué — ${upErr.message}`);
    continue;
  }
  const { error: dbErr } = await supabase
    .from("chauffeurs")
    .update({ selfie_url: path })
    .eq("id", ch.id);
  if (dbErr) {
    console.error(`  ✗ ${ch.full_name} : update échoué — ${dbErr.message}`);
    continue;
  }
  console.log(
    `  ✓ ${ch.full_name} (${ch.is_female ? "F" : "H"}, ${ch.gamme}) ← ${src} (${buf.length} o)`
  );
}
console.log("Terminé.");
