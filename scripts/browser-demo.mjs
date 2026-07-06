import { chromium } from "playwright";
import { mkdirSync } from "node:fs";
const BASE = "https://coligo.app";
const OUT = "./playwright-shots";
mkdirSync(OUT, { recursive: true });

async function login(page, path, fields) {
  await page.goto(BASE + path, {
    waitUntil: "domcontentloaded",
    timeout: 45000,
  });
  for (const [s, v] of Object.entries(fields))
    await page.fill(s, v, { timeout: 15000 });
  await page
    .click("button[type=submit]", { timeout: 15000 })
    .catch(() => page.keyboard.press("Enter"));
  await page.waitForTimeout(3500);
  return page.url();
}
async function shot(page, path, name) {
  await page
    .goto(BASE + path, { waitUntil: "domcontentloaded", timeout: 45000 })
    .catch(() => {});
  await page.waitForTimeout(2500);
  await page
    .screenshot({ path: `${OUT}/${name}.png`, fullPage: true })
    .catch(() => {});
  console.log("  shot", name, "→", page.url().replace(BASE, ""));
}

(async () => {
  const b = await chromium.launch({ headless: true });
  // CLIENT
  {
    const ctx = await b.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
    });
    const p = await ctx.newPage();
    console.log(
      "CLIENT login →",
      await login(p, "/se-connecter", {
        "#email": "qawaexpress@gmail.com",
        "#password": "qawaexpress@gmail.com",
      })
    );
    await shot(p, "/commandes", "demo-client-commandes");
    await ctx.close();
  }
  // LIVREUR
  {
    const ctx = await b.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
    });
    const p = await ctx.newPage();
    console.log(
      "LIVREUR login →",
      await login(p, "/driver/login", {
        "#phone": "0603044618",
        "#password": "0603044618",
      })
    );
    await shot(p, "/driver", "demo-livreur-accueil");
    await ctx.close();
  }
  // COMMERÇANT (Superette / thefast)
  {
    const ctx = await b.newContext({
      viewport: { width: 390, height: 844 },
      deviceScaleFactor: 2,
    });
    const p = await ctx.newPage();
    console.log(
      "MERCHANT login →",
      await login(p, "/login", {
        "#email": "thefast.contact@gmail.com",
        "#password": "thefast.contact@gmail.com",
      })
    );
    await shot(p, "/dashboard", "demo-merchant-dashboard");
    await ctx.close();
  }
  await b.close();
})();
