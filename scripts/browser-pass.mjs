/**
 * Passe navigateur (Playwright) sur l'app DÉPLOYÉE avec les comptes de test.
 * Connexion par rôle → visite des écrans clés → capture + détection d'erreurs
 * (console.error, pageerror, overlay Next, "Application error"). Lecture seule.
 */
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = "https://coligo.app";
const OUT = "./playwright-shots";
mkdirSync(OUT, { recursive: true });

const results = [];
function log(s) {
  console.log(s);
}

async function newCtx(browser) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  const errors = [];
  ctx.on("weberror", (e) => errors.push(String(e.error())));
  return { ctx, errors };
}

async function visit(page, errors, name, path) {
  const url = BASE + path;
  let status = "?";
  const pageErrors = [];
  const onErr = (e) => pageErrors.push(String(e));
  page.on("pageerror", onErr);
  try {
    const resp = await page.goto(url, {
      waitUntil: "domcontentloaded",
      timeout: 45000,
    });
    status = resp ? resp.status() : "no-resp";
  } catch (e) {
    status = "TIMEOUT/" + e.message.slice(0, 40);
  }
  await page.waitForTimeout(1200);
  // Détection d'erreurs visibles
  const overlay = await page
    .locator(
      "[data-nextjs-dialog], #nextjs__container_errors, text=Application error"
    )
    .count()
    .catch(() => 0);
  const file = `${OUT}/${name}.png`;
  await page.screenshot({ path: file, fullPage: false }).catch(() => {});
  page.off("pageerror", onErr);
  const ok =
    (status === 200 || status === 304) &&
    overlay === 0 &&
    pageErrors.length === 0;
  results.push({ name, path, status, overlay, pageErrors: pageErrors.length });
  log(
    `  ${ok ? "✅" : "⚠️ "} ${name.padEnd(26)} status=${status} overlay=${overlay} pageErr=${pageErrors.length}`
  );
  if (pageErrors.length) log("       " + pageErrors[0].slice(0, 120));
}

async function login(page, path, fields, submitText) {
  await page.goto(BASE + path, {
    waitUntil: "domcontentloaded",
    timeout: 45000,
  });
  for (const [sel, val] of Object.entries(fields)) {
    await page.fill(sel, val, { timeout: 15000 });
  }
  await Promise.all([
    page.waitForLoadState("domcontentloaded", { timeout: 45000 }),
    page
      .click(`button[type=submit]`, { timeout: 15000 })
      .catch(() => page.keyboard.press("Enter")),
  ]);
  await page.waitForTimeout(2000);
  return page.url();
}

(async () => {
  const browser = await chromium.launch({ headless: true });

  // ===== CLIENT =====
  log("\n── CLIENT (qawaexpress@gmail.com)");
  {
    const { ctx, errors } = await newCtx(browser);
    const page = await ctx.newPage();
    try {
      const after = await login(page, "/se-connecter", {
        "#email": "qawaexpress@gmail.com",
        "#password": "qawaexpress@gmail.com",
      });
      log(`  login → ${after.replace(BASE, "")}`);
      await visit(page, errors, "client-accueil", "/");
      await visit(page, errors, "client-commandes", "/commandes");
      // 1ʳᵉ commande de la liste (détail : avis livreur + signalement si livrée)
      const href = await page
        .locator('a[href^="/commandes/"]')
        .first()
        .getAttribute("href")
        .catch(() => null);
      if (href) await visit(page, errors, "client-commande-detail", href);
      await visit(page, errors, "client-compte", "/compte");
    } catch (e) {
      log("  ❌ CLIENT échec: " + e.message.slice(0, 120));
    }
    await ctx.close();
  }

  // ===== LIVREUR =====
  log("\n── LIVREUR (0603044618)");
  {
    const { ctx, errors } = await newCtx(browser);
    const page = await ctx.newPage();
    try {
      const after = await login(page, "/driver/login", {
        "#phone": "0603044618",
        "#password": "0603044618",
      });
      log(`  login → ${after.replace(BASE, "")}`);
      await visit(page, errors, "livreur-accueil", "/driver");
      await visit(page, errors, "livreur-gains", "/driver/gains");
      await visit(page, errors, "livreur-historique", "/driver/historique");
    } catch (e) {
      log("  ❌ LIVREUR échec: " + e.message.slice(0, 120));
    }
    await ctx.close();
  }

  // ===== COMMERÇANT =====
  log("\n── COMMERÇANT (thefast.contact@gmail.com)");
  {
    const { ctx, errors } = await newCtx(browser);
    const page = await ctx.newPage();
    try {
      const after = await login(page, "/login", {
        "#email": "thefast.contact@gmail.com",
        "#password": "thefast.contact@gmail.com",
      });
      log(`  login → ${after.replace(BASE, "")}`);
      await visit(page, errors, "commercant-dashboard", "/dashboard");
      await visit(page, errors, "commercant-orders", "/orders");
      const href = await page
        .locator('a[href^="/orders/"]')
        .first()
        .getAttribute("href")
        .catch(() => null);
      if (href && href !== "/orders/validate")
        await visit(page, errors, "commercant-order-detail", href);
    } catch (e) {
      log("  ❌ COMMERÇANT échec: " + e.message.slice(0, 120));
    }
    await ctx.close();
  }

  await browser.close();
  const bad = results.filter(
    (r) =>
      !(
        (r.status === 200 || r.status === 304) &&
        r.overlay === 0 &&
        r.pageErrors === 0
      )
  );
  log(`\n═══ ${results.length} écrans visités, ${bad.length} avec souci ═══`);
  process.exit(0);
})().catch((e) => {
  console.error("FATAL", e.message);
  process.exit(1);
});
