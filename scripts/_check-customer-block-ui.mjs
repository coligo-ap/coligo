/**
 * Contrôle CLIENT des messages de restriction (mig 0397) : suspend le compte de
 * test + coupe Coligo Pay, se connecte comme ce client, vérifie que les
 * messages apparaissent, puis REMET TOUT EN ÉTAT (try/finally).
 *
 *   node scripts/_check-customer-block-ui.mjs <dossier-sortie>
 */
import { chromium } from "playwright";
import pg from "pg";
import { getDbUrl, loadEnvLocal } from "./_supabase.mjs";

loadEnvLocal();
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.argv[2] ?? ".";
const EMAIL = "qawaexpress@gmail.com"; // compte client de test (mdp = identifiant)

const db = new pg.Client({
  connectionString: getDbUrl(),
  ssl: { rejectUnauthorized: false },
});
await db.connect();

const { rows } = await db.query(
  "select id, is_blocked from public.customers where email = $1",
  [EMAIL]
);
if (!rows.length) throw new Error(`client de test introuvable : ${EMAIL}`);
const customerId = rows[0].id;
const wasBlocked = rows[0].is_blocked === true;

let browser;
try {
  // 1. Restrictions de test.
  // ⚠️ `set_config(..., true)` = LOCAL À LA TRANSACTION : le GUC et l'UPDATE
  // doivent être dans la MÊME transaction, sinon `protect_customer_risk_fields`
  // remet l'ancienne valeur sans rien dire.
  await db.query("begin");
  await db.query("select set_config('app.allow_risk_update','on',true)");
  await db.query(
    `update public.customers
        set is_blocked = true,
            blocked_at = now(),
            blocked_reason = 'Contrôle automatisé (à ignorer)',
            blocked_by = 'qa'
      where id = $1`,
    [customerId]
  );
  await db.query("commit");
  await db.query(
    `insert into public.customer_feature_blocks (customer_id, feature, reason, blocked_by)
     values ($1,'coligo_pay','Contrôle automatisé','qa')
     on conflict (customer_id, feature) do nothing`,
    [customerId]
  );

  // 2. Parcours client.
  browser = await chromium.launch();
  const page = await browser.newPage({ viewport: { width: 412, height: 900 } });
  await page.goto(`${BASE}/se-connecter`, {
    waitUntil: "domcontentloaded",
    timeout: 180000,
  });
  await page.fill("#email", EMAIL);
  await page.fill("#password", EMAIL);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(9000);
  console.log("après login :", page.url());

  const checks = [
    ["/", "banniere-suspension.png", "Compte suspendu"],
    ["/coligo-pay", "coligo-pay-coupe.png", "Désactivé sur votre compte"],
    ["/cashback", "cashback-actif.png", null],
  ];
  for (const [path, file, expect] of checks) {
    await page.goto(`${BASE}${path}`, {
      waitUntil: "domcontentloaded",
      timeout: 180000,
    });
    await page.waitForTimeout(5000);
    await page.screenshot({ path: `${OUT}/${file}` });
    const body = ((await page.textContent("body")) ?? "").replace(/\s+/g, " ");
    if (expect) {
      console.log(
        `${body.includes(expect) ? "✅" : "❌"} ${path} — « ${expect} »`
      );
    } else {
      console.log(`•  ${path} capturé`);
    }
  }
} finally {
  // 3. Remise en état SYSTÉMATIQUE.
  await db.query("begin");
  await db.query("select set_config('app.allow_risk_update','on',true)");
  await db.query(
    `update public.customers
        set is_blocked = $2, blocked_at = null, blocked_reason = null, blocked_by = null
      where id = $1`,
    [customerId, wasBlocked]
  );
  await db.query("commit");
  await db.query(
    "delete from public.customer_feature_blocks where customer_id = $1 and feature = 'coligo_pay'",
    [customerId]
  );
  const { rows: after } = await db.query(
    `select is_blocked,
            (select count(*) from public.customer_feature_blocks b where b.customer_id = c.id) as coupures
       from public.customers c where c.id = $1`,
    [customerId]
  );
  console.log("état restauré :", JSON.stringify(after[0]));
  await db.end();
  if (browser) await browser.close();
}
