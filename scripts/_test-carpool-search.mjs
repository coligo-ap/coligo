// Covoiturage client — « recherche d'abord » : aucun trajet tant que le départ
// ET l'arrivée ne sont pas renseignés, et message inline si l'un manque.
//
//   BASE=http://localhost:3011 node scripts/_test-carpool-search.mjs
//   BASE=https://coligo.app    node scripts/_test-carpool-search.mjs
//
// Quatre contrôles :
//   1. À l'ouverture : invitation à saisir le trajet, AUCUN trajet listé.
//   2. Tap « Rechercher » à vide : message inline (et toujours aucun trajet).
//   3. Un seul champ renseigné : message inline ciblé sur le champ manquant.
//   4. Les deux renseignés : la recherche part (résultats ou « aucun départ »),
//      et le message d'erreur a disparu.
//
// ⚠ En LOCAL, lancer `next dev` avec les variables Supabase de PROD.
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3011";
const EMAIL = process.env.QA_CUSTOMER ?? "qawaexpress@gmail.com";
const PASS = process.env.QA_CUSTOMER_PASS ?? EMAIL;

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "OK  " : "KO  "} ${name}${detail ? ` — ${detail}` : ""}`);
}

/**
 * Renseigne un champ de lieu et retient la 1ʳᵉ suggestion. Les suggestions
 * sont des <button> dans un panneau flottant : on clique le BOUTON (ses
 * <span> internes interceptent le pointeur).
 */
async function pickPlace(page, index, query) {
  const inputs = page.locator(
    ".drive-screen input[type='text'], .drive-screen input:not([type]):not([type='date'])"
  );
  await inputs.nth(index).click();
  await inputs.nth(index).fill(query);
  const sugg = page.locator("button", { hasText: new RegExp(query, "i") });
  const ok = await until(
    page,
    async () => (await sugg.count()) > 0 && (await sugg.first().isVisible()),
    12000
  );
  if (!ok) return false;
  await sugg.first().click({ force: true });
  await page.waitForTimeout(700);
  return true;
}

async function until(page, fn, deadline = 30000) {
  const stop = Date.now() + deadline;
  for (;;) {
    try {
      if (await fn()) return true;
    } catch {
      /* navigation en cours */
    }
    if (Date.now() > stop) return false;
    await page.waitForTimeout(500);
  }
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  locale: "fr-DZ",
  permissions: [],
});
await ctx.addCookies([{ name: "NEXT_LOCALE", value: "fr", url: BASE }]);
const page = await ctx.newPage();

// ── Connexion client ──────────────────────────────────────────────────────
await page.goto(BASE + "/se-connecter", {
  waitUntil: "domcontentloaded",
  timeout: 120000,
});
await until(page, async () => (await page.locator("#email").count()) > 0);
await page.fill("#email", EMAIL);
await page.fill("#password", PASS);
await page.click('button[type="submit"]');
const logged = await until(
  page,
  async () => !page.url().includes("se-connecter"),
  45000
);
if (!logged) {
  check("connexion client", false, page.url());
  await browser.close();
  process.exit(1);
}

// ── 1. Ouverture : invitation, aucun trajet ───────────────────────────────
await page.goto(BASE + "/drive/covoiturage", {
  waitUntil: "domcontentloaded",
  timeout: 120000,
});
await until(page, async () =>
  /Où vas-tu|Aucun départ|trajet\(s\)/i.test(
    await page.locator("body").innerText()
  )
);
let body = await page.locator("body").innerText();
check(
  "ouverture : invitation à saisir le trajet",
  /Où vas-tu/i.test(body) && !/trajet\(s\) disponible\(s\)/i.test(body),
  body.replace(/\s+/g, " ").slice(0, 90)
);

// ── 2. Rechercher à vide → message inline ─────────────────────────────────
// Le départ peut avoir été prérempli par le GPS : on vide les deux champs.
const inputs = page.locator(
  ".drive-screen input[type='text'], .drive-screen input:not([type]):not([type='date'])"
);
const n = await inputs.count();
for (let i = 0; i < Math.min(n, 2); i++) {
  await inputs.nth(i).fill("");
}
await page.keyboard.press("Escape");
await page.getByRole("button", { name: /Rechercher/i }).click();
await page.waitForTimeout(1200);
body = await page.locator("body").innerText();
check(
  "recherche à vide : message inline",
  /Choisis le départ et l'arrivée|Choisis ton point de départ|Choisis ta destination/i.test(
    body
  ),
  body.replace(/\s+/g, " ").slice(0, 90)
);
check(
  "recherche à vide : toujours aucun trajet",
  !/trajet\(s\) disponible\(s\)/i.test(body)
);

// ── 3. Un seul champ → message ciblé ──────────────────────────────────────
check("suggestion de départ retenue", await pickPlace(page, 0, "Alger"));
await page.getByRole("button", { name: /Rechercher/i }).click();
await page.waitForTimeout(1200);
body = await page.locator("body").innerText();
check(
  "départ seul : message sur la destination",
  /Choisis ta destination/i.test(body),
  body.replace(/\s+/g, " ").slice(0, 90)
);

// ── 4. Les deux → la recherche part ───────────────────────────────────────
check("suggestion d'arrivée retenue", await pickPlace(page, 1, "Béjaïa"));
await page.getByRole("button", { name: /Rechercher/i }).click();
await until(
  page,
  async () =>
    /trajet\(s\) disponible\(s\)|Aucun départ publié/i.test(
      await page.locator("body").innerText()
    ),
  20000
);
body = await page.locator("body").innerText();
check(
  "départ + arrivée : la recherche part",
  /trajet\(s\) disponible\(s\)|Aucun départ publié/i.test(body) &&
    !/Où vas-tu/i.test(body),
  body.replace(/\s+/g, " ").slice(0, 90)
);
check(
  "message d'erreur effacé",
  !/Choisis (le départ|ton point|ta destination)/i.test(body)
);

await page.screenshot({
  path:
    process.env.SHOT ??
    "C:/Users/gaci/AppData/Local/Temp/claude/C--Users-gaci-Desktop-noti-dz-coligo-v3-violet/25ac6e4c-ac0d-404f-96bb-d04e5a1d7281/scratchpad/carpool.png",
});
await browser.close();
console.log(
  failures === 0
    ? "\n✅ covoiturage : recherche d'abord"
    : `\n❌ ${failures} cas KO`
);
process.exit(failures === 0 ? 0 : 1);
