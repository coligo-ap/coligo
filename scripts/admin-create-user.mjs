#!/usr/bin/env node
/**
 * Crée (ou met à jour) un compte Supabase Auth via la service_role key.
 * Auto-confirme l'email — utilisable pour le compte super-admin coligo.noreply.
 *
 *   node scripts/admin-create-user.mjs <email> <password>
 *
 * Lit SUPABASE_SERVICE_ROLE_KEY et NEXT_PUBLIC_SUPABASE_URL depuis .env.local
 * (jamais de hardcode).
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
    ) {
      val = val.slice(1, -1);
    }
    if (process.env[m[1]] === undefined) process.env[m[1]] = val;
  }
}

async function main() {
  loadEnvLocal();
  const [, , email, password] = process.argv;
  if (!email || !password) {
    console.error(
      "Usage: node scripts/admin-create-user.mjs <email> <password>"
    );
    process.exit(1);
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.error(
      "Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY"
    );
    process.exit(1);
  }
  const supa = createClient(url, key, { auth: { persistSession: false } });

  // On tente createUser direct. Si l'email existe déjà, l'API renvoie une
  // erreur ; on retombe sur un UPDATE via PATCH /admin/users/{id} après
  // lookup direct (REST, GET ?email= n'est pas garanti — on liste 1 par 1).
  const { data: created, error: createErr } = await supa.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
  });
  if (!createErr) {
    console.log(`✔ user créé (id=${created.user.id}, email=${email})`);
    return;
  }

  // Email existe déjà → on cherche son id via REST GoTrue puis update.
  if (/already (been )?registered|exists|duplicate/i.test(createErr.message)) {
    const res = await fetch(
      `${url}/auth/v1/admin/users?email=${encodeURIComponent(email)}`,
      {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
        },
      }
    );
    if (!res.ok) {
      console.error("GoTrue lookup failed:", res.status, await res.text());
      process.exit(1);
    }
    const json = await res.json();
    const u = Array.isArray(json.users) ? json.users[0] : json;
    if (!u?.id) {
      console.error("User exists but lookup returned no id:", json);
      process.exit(1);
    }
    const { error: updErr } = await supa.auth.admin.updateUserById(u.id, {
      password,
      email_confirm: true,
    });
    if (updErr) {
      console.error("updateUserById failed:", updErr.message);
      process.exit(1);
    }
    console.log(`✔ user existant mis à jour (id=${u.id}, email=${email})`);
    return;
  }
  console.error("createUser failed:", createErr.message);
  process.exit(1);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
