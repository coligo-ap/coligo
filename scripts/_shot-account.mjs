// Captures CLIENT CONNECTÉ : header de l'accueil (sans compte ni sombre) +
// Compte › Préférences (langue + apparence), en clair et en sombre.
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const EMAIL = process.env.EMAIL ?? "qawaexpress@gmail.com";
const OUT = process.env.OUT ?? "./shots";
const TAG = process.argv[2] ?? "shot";
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({ headless: true });
const ctx = await b.newContext({
  viewport: { width: 390, height: 844 },
  deviceScaleFactor: 2,
  locale: "fr-DZ",
});
await ctx.addCookies([{ name: "NEXT_LOCALE", value: "fr", url: BASE }]);
const p = await ctx.newPage();

await p.goto(`${BASE}/se-connecter`, {
  waitUntil: "domcontentloaded",
  timeout: 120000,
});
await p.waitForTimeout(3000);
await p.fill("#email", EMAIL);
await p.fill("#password", EMAIL);
await p.click('button[type="submit"]');
// Serveur dev FROID : la 1re compilation de la route d'auth peut dépasser 10 s.
await p
  .waitForURL((u) => !u.pathname.includes("se-connecter"), { timeout: 90000 })
  .catch(() => {});
await p.waitForTimeout(3000);
if (p.url().includes("se-connecter")) {
  console.log("ÉCHEC login —", p.url());
  await p.screenshot({ path: `${OUT}/${TAG}-login-echec.png` });
  await b.close();
  process.exit(1);
}
console.log("connecté →", p.url());

// Accueil connecté : le header ne doit plus porter ni avatar ni lune.
await p.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 120000 });
await p.waitForTimeout(8000);
await p.screenshot({ path: `${OUT}/${TAG}-home-authed.png`, timeout: 30000 });
console.log("ok home-authed");

// Compte › Préférences.
await p.goto(BASE + "/compte", {
  waitUntil: "domcontentloaded",
  timeout: 120000,
});
await p.waitForTimeout(7000);
const prefs = p.getByText("Préférences", { exact: true });
if (await prefs.count()) await prefs.first().scrollIntoViewIfNeeded();
await p.waitForTimeout(1200);
await p.screenshot({ path: `${OUT}/${TAG}-compte-prefs.png`, timeout: 30000 });
console.log("ok compte-prefs");

// Bascule sombre depuis la rangée, puis re-capture (doit s'appliquer sans
// rechargement) + retour sur l'accueil pour vérifier la persistance.
const sw = p.locator('button[role="switch"]').first();
if (await sw.count()) {
  await sw.click();
  await p.waitForTimeout(1500);
  await p.screenshot({
    path: `${OUT}/${TAG}-compte-prefs-dark.png`,
    timeout: 30000,
  });
  console.log("ok compte-prefs-dark");
  await p.goto(BASE + "/", { waitUntil: "domcontentloaded", timeout: 120000 });
  await p.waitForTimeout(8000);
  await p.screenshot({
    path: `${OUT}/${TAG}-home-authed-dark.png`,
    timeout: 30000,
  });
  console.log("ok home-authed-dark (persistance cookie)");
} else {
  console.log("interrupteur introuvable");
}

await ctx.close();
await b.close();
