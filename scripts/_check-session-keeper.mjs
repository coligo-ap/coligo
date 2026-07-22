/**
 * Contrôle du FILET DE SESSION (retour dans l'app après un paiement externe).
 *
 *   node scripts/_check-session-keeper.mjs
 *
 * Scénario reproduit : le client est connecté, part payer sur une page externe,
 * et revient dans une WebView qui a PERDU ses cookies. On simule exactement
 * cela — suppression des cookies d'auth, puis retour au premier plan — et on
 * vérifie que la session est réinstallée SANS reconnexion ni redémarrage.
 */
import { chromium } from "playwright";
import { loadEnvLocal } from "./_supabase.mjs";

loadEnvLocal();
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const EMAIL = "qawaexpress@gmail.com";

let pass = 0;
let fail = 0;
const check = (label, ok, detail = "") => {
  ok ? pass++ : fail++;
  console.log(`${ok ? "✅" : "❌"} ${label}${detail ? ` — ${detail}` : ""}`);
};

const browser = await chromium.launch();
try {
  const ctx = await browser.newContext({
    viewport: { width: 412, height: 900 },
  });
  const page = await ctx.newPage();
  await page.goto(`${BASE}/se-connecter`, {
    waitUntil: "domcontentloaded",
    timeout: 180000,
  });
  await page.fill("#email", EMAIL);
  await page.fill("#password", EMAIL);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(9000);

  await page.goto(`${BASE}/compte`, {
    waitUntil: "domcontentloaded",
    timeout: 180000,
  });
  await page.waitForTimeout(5000);
  const before = ((await page.textContent("body")) ?? "").includes(
    "Déconnexion"
  );
  check("connecté au départ", before);

  // La copie de session doit exister (ici en localStorage : contexte web).
  const backup = await page.evaluate(() =>
    window.localStorage.getItem("coligo.session.backup")
  );
  check("copie de session enregistrée", !!backup);

  // ── Simulation du retour d'un paiement externe : la WebView revient SANS
  //    ses cookies d'authentification.
  const cookies = await ctx.cookies();
  const auth = cookies.filter((c) => c.name.startsWith("sb-"));
  await ctx.clearCookies();
  check(
    "cookies d'auth supprimés (simulation)",
    auth.length > 0,
    `${auth.length} cookie(s)`
  );

  // Retour au premier plan : c'est ce qu'écoute le filet.
  await page.evaluate(() => {
    document.dispatchEvent(new Event("visibilitychange"));
    window.dispatchEvent(new Event("focus"));
  });
  await page.waitForTimeout(6000);

  const restored = await ctx
    .cookies()
    .then((cs) => cs.filter((c) => c.name.startsWith("sb-")).length);
  check(
    "session réinstallée sans reconnexion",
    restored > 0,
    `${restored} cookie(s)`
  );

  await page.goto(`${BASE}/compte`, {
    waitUntil: "domcontentloaded",
    timeout: 180000,
  });
  await page.waitForTimeout(5000);
  const body = ((await page.textContent("body")) ?? "").replace(/\s+/g, " ");
  check(
    "l'écran Compte reste authentifié",
    body.includes("Déconnexion") &&
      (body.includes("Lina") || body.includes("qawaexpress")),
    body.includes("Lina") || body.includes("qawaexpress")
      ? "identité du compte visible"
      : "identité ABSENTE"
  );

  console.log(`\n${pass} succès, ${fail} échec(s)`);
} finally {
  await browser.close();
}
process.exit(fail ? 1 : 0);
