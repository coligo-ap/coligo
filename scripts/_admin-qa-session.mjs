/**
 * Session admin de CONTRÔLE : crée un compte staff temporaire (domaine passé en
 * option), se connecte au portail, capture les pages demandées, puis SUPPRIME
 * le compte. Sert à vérifier une page admin sans toucher aux comptes réels.
 *
 *   node scripts/_admin-qa-session.mjs <domaine> "/page1,sortie1.png" "/page2,sortie2.png"
 */
import { chromium } from "playwright";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { getDbUrl, loadEnvLocal } from "./_supabase.mjs";

loadEnvLocal();
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const DOMAIN = process.argv[2] ?? "clients";
const EMAIL = "qa-admin@coligo.local";
const PASSWORD = "Qa!coligo2026";
const pairs = process.argv.slice(3).map((a) => a.split(","));

const sb = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY,
  { auth: { persistSession: false } }
);
const db = new pg.Client({
  connectionString: getDbUrl(),
  ssl: { rejectUnauthorized: false },
});
await db.connect();

let userId = null;
try {
  // 1. Compte auth temporaire (e-mail auto-confirmé).
  const { data: created, error } = await sb.auth.admin.createUser({
    email: EMAIL,
    password: PASSWORD,
    email_confirm: true,
  });
  if (error && !/already/i.test(error.message)) throw error;
  if (created?.user) userId = created.user.id;
  if (!userId) {
    const { data: list } = await sb.auth.admin.listUsers({ perPage: 200 });
    userId = list.users.find((u) => u.email === EMAIL)?.id ?? null;
    if (userId)
      await sb.auth.admin.updateUserById(userId, { password: PASSWORD });
  }

  // 2. Droits admin scopés au seul domaine testé.
  await db.query(
    `insert into public.platform_admins (email, role, domains, is_active)
     values ($1,'staff',array[$2]::text[], true)
     on conflict (email) do update set domains = excluded.domains, is_active = true`,
    [EMAIL, DOMAIN]
  );

  // 3. Connexion au portail + captures.
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 1000 },
  });
  const errors = [];
  page.on("pageerror", (e) =>
    errors.push(`[pageerror] ${e.message.slice(0, 160)}`)
  );
  page.on("console", (m) => {
    if (m.type() === "error")
      errors.push(`[console] ${m.text().slice(0, 160)}`);
  });

  await page.goto(`${BASE}/portail`, {
    waitUntil: "domcontentloaded",
    timeout: 180000,
  });
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(8000);
  console.log("après login :", page.url());

  for (const [path, out] of pairs) {
    await page.goto(`${BASE}${path}`, {
      waitUntil: "domcontentloaded",
      timeout: 180000,
    });
    await page.waitForTimeout(5000);
    await page.screenshot({ path: out, fullPage: true });
    const body = ((await page.textContent("body")) ?? "").replace(/\s+/g, " ");
    console.log(`ok ${path} → ${out} (${body.length} car.)`);
  }
  if (errors.length) console.log("ERREURS:\n" + errors.slice(0, 8).join("\n"));
  await browser.close();
} finally {
  // 4. Nettoyage systématique.
  await db.query("delete from public.platform_admins where email = $1", [
    EMAIL,
  ]);
  if (userId) await sb.auth.admin.deleteUser(userId);
  await db.end();
  console.log("compte de contrôle supprimé");
}
