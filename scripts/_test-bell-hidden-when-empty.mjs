// Cloche client : MASQUÉE tant qu'il n'y a aucune notification, elle apparaît
// dès la première — sans rechargement (temps réel).
//
//   BASE=http://localhost:3011 node scripts/_test-bell-hidden-when-empty.mjs
//   BASE=https://coligo.app    node scripts/_test-bell-hidden-when-empty.mjs
//
// Le test INSÈRE une notification de test sur le compte client de QA puis la
// SUPPRIME, quoi qu'il arrive (bloc finally) — il ne laisse aucune trace.
//
// ⚠ En LOCAL, lancer `next dev` avec les variables Supabase de PROD.
import { chromium } from "playwright";
import { createClient } from "@supabase/supabase-js";

const BASE = process.env.BASE ?? "http://localhost:3011";
const EMAIL = process.env.QA_CUSTOMER ?? "qawaexpress@gmail.com";
const PASS = process.env.QA_CUSTOMER_PASS ?? EMAIL;
const MARK = "QA cloche — à supprimer";

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "OK  " : "KO  "} ${name}${detail ? ` — ${detail}` : ""}`);
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

const admin = createClient(
  process.env.NEXT_PUBLIC_SUPABASE_URL,
  process.env.SUPABASE_SERVICE_ROLE_KEY
);

// Compte client de QA + purge d'un éventuel reliquat d'un run précédent.
const { data: users } = await admin.auth.admin.listUsers({ perPage: 1000 });
const customer = users.users.find((u) => u.email === EMAIL);
if (!customer) {
  console.log("KO   compte client de QA introuvable");
  process.exit(1);
}
await admin
  .from("user_notifications")
  .delete()
  .eq("user_id", customer.id)
  .eq("title", MARK);

const { count: existing } = await admin
  .from("user_notifications")
  .select("id", { count: "exact", head: true })
  .eq("user_id", customer.id)
  .eq("audience", "customer");
if ((existing ?? 0) > 0) {
  console.log(
    `KO   le compte de QA a déjà ${existing} notification(s) — le cas « aucune » n'est pas testable`
  );
  process.exit(1);
}

const browser = await chromium.launch({ headless: true });
const ctx = await browser.newContext({
  viewport: { width: 390, height: 844 },
  locale: "fr-DZ",
  permissions: [],
});
await ctx.addCookies([{ name: "NEXT_LOCALE", value: "fr", url: BASE }]);
const page = await ctx.newPage();
/** La cloche est le seul bouton portant l'aria-label « Notifications ». */
const bell = page.getByRole("button", { name: /Notifications/i });

try {
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
    throw new Error("login");
  }

  await page.goto(BASE + "/", {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });
  // Le panier, lui, doit être là : il prouve que le header est bien rendu et
  // que l'absence de cloche n'est pas un header qui n'a pas fini de charger.
  await until(
    page,
    async () => (await page.getByRole("link", { name: /Panier/i }).count()) > 0
  );
  await page.waitForTimeout(6000); // laisse le temps au poll initial

  check("aucune notification : cloche absente", (await bell.count()) === 0);

  // ── Une notification arrive → la cloche doit apparaître SANS rechargement ──
  const { error } = await admin.from("user_notifications").insert({
    user_id: customer.id,
    audience: "customer",
    kind: "info",
    title: MARK,
    body: "Vérification automatique de l'affichage de la cloche.",
  });
  check("notification de test insérée", !error, error?.message ?? "");

  const appeared = await until(
    page,
    async () => (await bell.count()) > 0,
    75000 // temps réel, sinon le filet de poll (60 s)
  );
  check("1ʳᵉ notification : cloche affichée sans rechargement", appeared);

  if (appeared) {
    await bell.first().click();
    const opened = await until(
      page,
      async () => /QA cloche/i.test(await page.locator("body").innerText()),
      15000
    );
    check("le centre de notifications s'ouvre et montre l'entrée", opened);
  }

  await page.screenshot({
    path:
      process.env.SHOT ??
      "C:/Users/gaci/AppData/Local/Temp/claude/C--Users-gaci-Desktop-noti-dz-coligo-v3-violet/25ac6e4c-ac0d-404f-96bb-d04e5a1d7281/scratchpad/bell.png",
  });
} finally {
  // Nettoyage systématique : le compte de QA repart de zéro.
  await admin
    .from("user_notifications")
    .delete()
    .eq("user_id", customer.id)
    .eq("title", MARK);
  await browser.close();
}

console.log(
  failures === 0 ? "\n✅ cloche client conforme" : `\n❌ ${failures} cas KO`
);
process.exit(failures === 0 ? 0 : 1);
