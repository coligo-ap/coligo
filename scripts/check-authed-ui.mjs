// Vérification UI AUTHENTIFIÉE sur la PROD : login réel sur les 3 espaces
// (client, chauffeur, livreur) puis visite des pages clés — capture les
// erreurs console / pageerror / HTTP ≥ 500.
import { chromium } from "playwright";

const BASE = process.env.CHECK_BASE ?? "https://coligo.app";
let totalErrors = 0;
const browser = await chromium.launch();

async function checkSpace(name, loginFn, paths) {
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) =>
    errors.push(`[pageerror] ${e.message.slice(0, 200)}`)
  );
  page.on("console", (m) => {
    if (m.type() === "error")
      errors.push(`[console] ${m.text().slice(0, 200)}`);
  });
  page.on("response", (r) => {
    if (r.status() >= 500) errors.push(`[http ${r.status()}] ${r.url()}`);
  });

  console.log(`\n===== ESPACE ${name.toUpperCase()} =====`);
  await loginFn(page);
  await page.waitForTimeout(6000);
  console.log(`   URL après login : ${page.url()}`);

  for (const p of paths) {
    await page.goto(`${BASE}${p}`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(4500);
    const body = ((await page.textContent("body")) ?? "").replace(/\s+/g, " ");
    const broken =
      body.includes("Une erreur est survenue") ||
      body.includes("Application error") ||
      body.length < 300;
    console.log(
      `   ${p} → ${broken ? "⚠️ CONTENU SUSPECT" : "OK"} (${body.length} car.)`
    );
    if (broken) errors.push(`[page] ${p} contenu suspect`);
  }

  // On ignore les erreurs réseau bénignes (favicon, analytics tiers).
  const relevant = errors.filter(
    (e) => !/favicon|googletagmanager|google-analytics/.test(e)
  );
  if (relevant.length === 0) console.log(`   ✅ ${name} : AUCUNE erreur`);
  else {
    console.log(`   ❌ ${name} : ${relevant.length} erreur(s)`);
    [...new Set(relevant)].slice(0, 8).forEach((e) => console.log(`     ${e}`));
    totalErrors += relevant.length;
  }
  await ctx.close();
}

// CLIENT
await checkSpace(
  "client",
  async (page) => {
    await page.goto(`${BASE}/se-connecter`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    await page.fill("#email", "qawaexpress@gmail.com");
    await page.fill("#password", "qawaexpress@gmail.com");
    await page.click("button[type=submit]");
  },
  ["/", "/drive", "/compte", "/commandes", "/drive/historique"]
);

// CHAUFFEUR
await checkSpace(
  "chauffeur",
  async (page) => {
    await page.goto(`${BASE}/chauffeur/login`, {
      waitUntil: "domcontentloaded",
    });
    await page.waitForTimeout(1500);
    await page.fill("input[type=tel]", "0603044618");
    await page.fill("input[name=password]", "0603044618");
    await page.click("button[type=submit]");
  },
  ["/chauffeur", "/chauffeur/demandes", "/chauffeur/gains", "/chauffeur/compte"]
);

// LIVREUR
await checkSpace(
  "livreur",
  async (page) => {
    await page.goto(`${BASE}/driver/login`, { waitUntil: "domcontentloaded" });
    await page.waitForTimeout(1500);
    await page.fill("input[type=tel]", "0603044618");
    await page.fill("input[name=password]", "0603044618");
    await page.click("button[type=submit]");
  },
  ["/driver", "/driver/gains", "/driver/historique", "/driver/notifications"]
);

await browser.close();
console.log(
  `\nRésultat global : ${totalErrors === 0 ? "✅ TOUT RÉPOND, AUCUNE ERREUR" : `❌ ${totalErrors} erreur(s)`}`
);
process.exit(totalErrors === 0 ? 0 : 1);
