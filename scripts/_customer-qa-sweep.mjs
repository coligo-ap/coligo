/**
 * BALAYAGE de l'espace CLIENT CONNECTÉ en prod : session réelle du compte de
 * test (qawaexpress — mdp = identifiant, jamais modifié), chargement de chaque
 * page (dont une commande TERMINÉE réelle → carte story). Redirections notées
 * (⚠, gardes d'état légitimes) ; échec = HTTP ≥ 400 / crash / pageerror.
 *
 *   BASE_URL=https://coligo-liart.vercel.app node scripts/_customer-qa-sweep.mjs
 */
import { chromium } from "playwright";
import pg from "pg";
import { getDbUrl, loadEnvLocal } from "./_supabase.mjs";

loadEnvLocal();
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const EMAIL = "qawaexpress@gmail.com";

const db = new pg.Client({ connectionString: getDbUrl() });
await db.connect();
const { rows: custRows } = await db.query(
  `select c.id from public.customers c join auth.users u on u.id = c.user_id where u.email = $1`,
  [EMAIL]
);
const custId = custRows[0]?.id ?? null;
const { rows: orderRows } = custId
  ? await db.query(
      `select id from public.orders where customer_id = $1 and status = 'completed' order by created_at desc limit 1`,
      [custId]
    )
  : { rows: [] };
const completedOrder = orderRows[0]?.id ?? null;
await db.end();

const routes = [
  "/compte",
  "/compte/infos",
  "/compte/telephone",
  "/adresses",
  "/favoris",
  "/commandes",
  completedOrder && `/commandes/${completedOrder}`,
  "/codes-promo",
  "/parrainage",
  "/roue",
  "/cashback",
  "/coligo-pay",
  "/coligo-pay/envoyer",
  "/coligo-pay/qr",
  "/drive",
  "/drive/historique",
  "/course",
  "/cart",
  "/checkout",
  "/m/superette-yemma",
].filter(Boolean);

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
let errors = [];
page.on("pageerror", (e) => errors.push(e.message.slice(0, 120)));

await page.goto(`${BASE}/se-connecter`, {
  waitUntil: "domcontentloaded",
  timeout: 120000,
});
await page.waitForTimeout(2500);
await page.fill("#email", EMAIL);
await page.fill("#password", EMAIL);
await page.click('button[type="submit"]');
await page.waitForTimeout(9000);
if (page.url().includes("se-connecter")) {
  console.error(`LOGIN ÉCHOUÉ — ${page.url()}`);
  process.exit(1);
}
console.log(`connecté → ${new URL(page.url()).pathname}`);

let bad = 0;
for (const path of routes) {
  errors = [];
  let status = 0;
  try {
    const resp = await page.goto(`${BASE}${path}`, {
      waitUntil: "domcontentloaded",
      timeout: 90000,
    });
    status = resp?.status() ?? 0;
    await page.waitForTimeout(2500);
  } catch (e) {
    console.log(`❌ ${path} — navigation: ${e.message.slice(0, 80)}`);
    bad++;
    continue;
  }
  const body = ((await page.textContent("body").catch(() => "")) ?? "").replace(
    /\s+/g,
    " "
  );
  const problems = [];
  if (status >= 400) problems.push(`HTTP ${status}`);
  if (/Application error/i.test(body)) problems.push("crash rendu");
  if (body.length < 150) problems.push(`corps ${body.length} car.`);
  if (errors.length) problems.push(errors[0]);
  const finalPath = new URL(page.url()).pathname;
  const note = finalPath !== path.split("?")[0] ? ` (→ ${finalPath})` : "";
  console.log(
    `${problems.length ? "❌" : "✅"} ${path}${note}${problems.length ? " — " + problems.join(" ; ") : ""}`
  );
  if (problems.length) bad++;
}
await browser.close();
console.log(
  `\n===== BILAN CLIENT CONNECTÉ : ${routes.length - bad}/${routes.length} OK =====`
);
process.exit(bad ? 1 : 0);
