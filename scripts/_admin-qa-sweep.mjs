/**
 * BALAYAGE A→Z des pages ADMIN en prod : crée un compte QA `super` (tous
 * domaines), se connecte au portail, charge CHAQUE page du back-office
 * (dynamiques comprises, avec de VRAIS ids lus en base) et signale :
 *   - statut HTTP ≥ 400 ;
 *   - crash client (« Application error »), erreurs pageerror/console ;
 *   - redirection hors de la page demandée (RBAC/garde inattendus) ;
 *   - corps suspect (< 200 caractères).
 * Nettoyage systématique du compte à la fin. AUCUNE écriture métier.
 *
 *   BASE_URL=https://coligo-liart.vercel.app node scripts/_admin-qa-sweep.mjs
 */
import { chromium } from "playwright";
import pg from "pg";
import { createClient } from "@supabase/supabase-js";
import { getDbUrl, loadEnvLocal } from "./_supabase.mjs";

loadEnvLocal();
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const EMAIL = "qa-sweep@coligo.local";
const PASSWORD = "Qa!coligo2026";
const DOMAINS = [
  "pilotage",
  "commercants",
  "livraison",
  "drive",
  "finances",
  "confiance",
  "plateforme",
  "marketing",
  "clients",
];

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

/** Premier id d'une table (ou null — la page dynamique sera sautée). */
async function firstId(sql) {
  try {
    const r = await db.query(sql);
    return r.rows[0]?.id ?? null;
  } catch {
    return null;
  }
}

let userId = null;
const report = [];
try {
  // Ids RÉELS pour les pages dynamiques (SÉQUENTIEL : un seul client pg).
  const order = await firstId(
    "select id from public.orders order by created_at desc limit 1"
  );
  const ride = await firstId(
    "select id from public.rides order by created_at desc limit 1"
  );
  const cust = await firstId(
    "select id from public.customers order by created_at desc limit 1"
  );
  const driver = await firstId(
    "select id from public.drivers order by created_at desc limit 1"
  );
  const chauffeur = await firstId(
    "select id from public.chauffeurs order by created_at desc limit 1"
  );
  const wallet = await firstId(
    "select id from public.operator_wallets where owner_type='partner' order by created_at desc limit 1"
  );
  const opWallet = await firstId(
    "select id from public.operator_wallets where owner_type<>'partner' order by created_at desc limit 1"
  );
  const idv = await firstId(
    "select id from public.idv_verifications order by created_at desc limit 1"
  );

  const routes = [
    "/admin",
    "/admin/alertes",
    "/admin/orders",
    order && `/admin/orders/${order}`,
    "/admin/clients",
    cust && `/admin/clients/${cust}`,
    "/admin/security",
    "/admin/devices",
    "/admin/integrity",
    "/admin/reports",
    "/admin/identite",
    "/admin/identite/dossiers",
    idv && `/admin/identite/dossiers/${idv}`,
    "/admin/anti-fraude",
    "/admin/anti-fraude/alertes",
    "/admin/anti-fraude/comptes",
    cust && `/admin/anti-fraude/comptes/customer/${cust}`,
    "/admin/anti-fraude/regles",
    "/admin/settings",
    "/admin/config",
    "/admin/zones",
    "/admin/admins",
    "/admin/categories",
    "/admin/controle",
    "/admin/codes-barres",
    "/admin/merchants",
    "/admin/merchants/taux",
    "/admin/merchants/commandes",
    "/admin/merchants/contrats",
    "/admin/merchants/finances",
    "/admin/merchants/visuels",
    "/admin/merchants/inscriptions",
    "/admin/drivers",
    "/admin/drivers/finances",
    "/admin/drivers/pass-prioritaire",
    "/admin/drivers/contrats",
    "/admin/drivers/inscriptions",
    "/admin/drivers/parametres",
    driver && `/admin/drivers/${driver}`,
    "/admin/chauffeurs",
    "/admin/chauffeurs/config",
    "/admin/chauffeurs/parametres",
    "/admin/chauffeurs/abonnements",
    "/admin/chauffeurs/contrats",
    "/admin/chauffeurs/courses",
    ride && `/admin/chauffeurs/courses/${ride}`,
    "/admin/chauffeurs/inscriptions",
    chauffeur && `/admin/chauffeurs/${chauffeur}`,
    "/admin/coligo-pay",
    "/admin/coligo-pay/versements",
    "/admin/coligo-pay/recharges",
    "/admin/coligo-pay/agents",
    "/admin/coligo-pay/inscriptions",
    "/admin/coligo-pay/portefeuilles",
    cust && `/admin/coligo-pay/portefeuilles/client/${cust}`,
    opWallet && `/admin/coligo-pay/portefeuilles/op/${opWallet}`,
    "/admin/coligo-pay/international",
    "/admin/marketing",
    "/admin/marketing/notifications",
    "/admin/marketing/bons",
    "/admin/marketing/codes",
    "/admin/marketing/parrainage",
    "/admin/marketing/annonces",
    "/admin/marketing/roue",
    "/admin/agents",
    wallet && `/admin/agents/${wallet}`,
    "/admin/recharges",
    "/admin/versements",
    "/admin/bannieres",
    "/admin/notifications",
    "/admin/livraison",
    "/admin/drive",
  ].filter(Boolean);

  // 1. Compte QA super (tous domaines) auto-confirmé.
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
  // Rôle `staff` (le CHECK n'admet que owner/staff) + LES 9 DOMAINES : couvre
  // toutes les pages gardées par requireAdminDomain/adminCan.
  await db.query(
    `insert into public.platform_admins (email, role, domains, is_active)
     values ($1,'staff',$2::text[], true)
     on conflict (email) do update set role='staff', domains = excluded.domains, is_active = true`,
    [EMAIL, DOMAINS]
  );

  // 2. Connexion + balayage.
  const browser = await chromium.launch();
  const page = await browser.newPage({
    viewport: { width: 1280, height: 1000 },
  });
  let pageErrors = [];
  page.on("pageerror", (e) =>
    pageErrors.push(`pageerror: ${e.message.slice(0, 140)}`)
  );
  page.on("console", (m) => {
    if (m.type() === "error")
      pageErrors.push(`console: ${m.text().slice(0, 140)}`);
  });

  await page.goto(`${BASE}/portail`, {
    waitUntil: "domcontentloaded",
    timeout: 180000,
  });
  await page.fill('input[type="email"]', EMAIL);
  await page.fill('input[type="password"]', PASSWORD);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(8000);
  if (!page.url().includes("/admin")) {
    console.error(`LOGIN ÉCHOUÉ — url=${page.url()}`);
    process.exit(1);
  }

  for (const path of routes) {
    pageErrors = [];
    let status = 0;
    try {
      const resp = await page.goto(`${BASE}${path}`, {
        waitUntil: "domcontentloaded",
        timeout: 60000,
      });
      status = resp?.status() ?? 0;
      await page.waitForTimeout(2200);
    } catch (e) {
      report.push({
        path,
        verdict: "NAVIGATION",
        detail: e.message.slice(0, 120),
      });
      continue;
    }
    const finalUrl = new URL(page.url());
    const body = (
      (await page.textContent("body").catch(() => "")) ?? ""
    ).replace(/\s+/g, " ");
    const problems = [];
    if (status >= 400) problems.push(`HTTP ${status}`);
    // /admin/admins est OWNER-ONLY (requireOwner) : la redirection du compte
    // staff QA est le comportement ATTENDU, pas un problème.
    const expectedRedirect = path === "/admin/admins";
    if (!expectedRedirect && !finalUrl.pathname.startsWith(path.split("?")[0]))
      problems.push(`redirigé vers ${finalUrl.pathname}`);
    if (
      /Application error|Une erreur est survenue|Internal Server Error/i.test(
        body
      )
    )
      problems.push("crash rendu");
    if (body.length < 200) problems.push(`corps ${body.length} car.`);
    if (pageErrors.length) problems.push(pageErrors.slice(0, 2).join(" | "));
    report.push({
      path,
      verdict: problems.length ? "PROBLÈME" : "ok",
      detail: problems.join(" ; "),
    });
    console.log(
      `${problems.length ? "❌" : "✅"} ${path}${problems.length ? " — " + problems.join(" ; ") : ""}`
    );
  }
  await browser.close();

  const bad = report.filter((r) => r.verdict !== "ok");
  console.log(
    `\n===== BILAN : ${report.length - bad.length}/${report.length} pages OK, ${bad.length} problème(s) =====`
  );
  process.exitCode = bad.length ? 1 : 0;
} finally {
  await db.query("delete from public.platform_admins where email = $1", [
    EMAIL,
  ]);
  if (userId) await sb.auth.admin.deleteUser(userId);
  await db.end();
  console.log("compte de contrôle supprimé");
}
