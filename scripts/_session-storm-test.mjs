/**
 * TEST DE ROBUSTESSE — course du refresh-token rotatif sous « tempête ».
 *
 * Reproduit le scénario qui TUAIT la session client (balayage du 05/08) :
 * un jeton d'accès EXPIRÉ + des rechargements complets rapprochés ⇒ chaque
 * requête (document + fetchs RSC parallèles) tente un refresh avec le même
 * refresh-token rotatif → sous l'ancienne config (fenêtre de réutilisation
 * 10 s), un rejeu tardif révoquait TOUTE la famille de jetons = déconnexion.
 *
 * Méthode : login par mot de passe (compte de test, famille de jetons NEUVE),
 * puis on FORGE le cookie de session avec `expires_at` dans le passé (le JWT
 * reste signé/valide ~1 h : seule la date du cookie force le refresh à CHAQUE
 * navigation). 12 rechargements complets rapprochés, puis vérification que la
 * session est TOUJOURS vivante sur une page protégée.
 *
 *   BASE_URL=https://coligo-liart.vercel.app node scripts/_session-storm-test.mjs
 */
import { chromium } from "playwright";
import { loadEnvLocal } from "./_supabase.mjs";

loadEnvLocal();
const BASE = process.env.BASE_URL ?? "https://coligo-liart.vercel.app";
const SUPA = process.env.NEXT_PUBLIC_SUPABASE_URL;
const ANON = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const REF = new URL(SUPA).hostname.split(".")[0];
const EMAIL = "qawaexpress@gmail.com"; // compte de test — mdp = identifiant

let pass = 0,
  fail = 0;
const ok = (cond, label) => {
  console.log(`${cond ? "✅" : "❌"} ${label}`);
  cond ? pass++ : fail++;
};

// 1) Famille de jetons neuve (n'affecte pas les autres sessions du compte).
const login = await fetch(`${SUPA}/auth/v1/token?grant_type=password`, {
  method: "POST",
  headers: { apikey: ANON, "Content-Type": "application/json" },
  body: JSON.stringify({ email: EMAIL, password: EMAIL }),
});
const session = await login.json();
ok(login.status === 200, `login ${EMAIL} — HTTP ${login.status}`);
if (login.status !== 200) process.exit(1);

// 2) Cookie de session FORGÉ : mêmes jetons, mais expires_at dans le passé →
//    chaque requête serveur croit le jeton expiré et tente un refresh.
const forged = {
  ...session,
  expires_at: Math.floor(Date.now() / 1000) - 120,
  expires_in: -120,
};
const b64 = Buffer.from(JSON.stringify(forged))
  .toString("base64")
  .replace(/\+/g, "-")
  .replace(/\//g, "_")
  .replace(/=+$/, "");
const value = `base64-${b64}`;
// Chunking identique à @supabase/ssr (limite 3180 caractères par cookie).
const MAX = 3180;
const cookies = [];
if (value.length <= MAX) {
  cookies.push({ name: `sb-${REF}-auth-token`, value });
} else {
  for (let i = 0; i * MAX < value.length; i++) {
    cookies.push({
      name: `sb-${REF}-auth-token.${i}`,
      value: value.slice(i * MAX, (i + 1) * MAX),
    });
  }
}

const browser = await chromium.launch();
const ctx = await browser.newContext({ viewport: { width: 390, height: 844 } });
const host = new URL(BASE).hostname;
await ctx.addCookies(
  cookies.map((c) => ({
    ...c,
    domain: host,
    path: "/",
    secure: true,
    sameSite: "Lax",
  }))
);
const page = await ctx.newPage();

// 3) TEMPÊTE : 12 rechargements complets rapprochés sur des pages protégées.
//    Chaque load = middleware (refresh) + fetchs RSC parallèles = courses.
const routes = ["/compte", "/commandes", "/adresses", "/favoris"];
let bounced = 0;
for (let i = 0; i < 12; i++) {
  const r = routes[i % routes.length];
  try {
    await page.goto(`${BASE}${r}`, {
      waitUntil: "domcontentloaded",
      timeout: 60000,
    });
  } catch {
    /* un timeout isolé n'est pas l'objet du test */
  }
  if (page.url().includes("se-connecter")) bounced++;
  await page.waitForTimeout(900);
}
console.log(
  `   tempête finie — rebonds login pendant la tempête : ${bounced}/12`
);

// 4) VERDICT : la session doit avoir SURVÉCU (page protégée accessible).
await page.waitForTimeout(2000);
await page.goto(`${BASE}/compte`, {
  waitUntil: "domcontentloaded",
  timeout: 60000,
});
await page.waitForTimeout(2500);
const finalUrl = page.url();
ok(
  !finalUrl.includes("se-connecter"),
  `session VIVANTE après la tempête (/compte servi, pas /se-connecter) — ${new URL(finalUrl).pathname}`
);
// Tolérance : un rebond transitoire (requête perdante isolée) est acceptable,
// une session morte (rebonds en série puis état final déconnecté) ne l'est pas.
ok(bounced <= 2, `rebonds transitoires bornés (${bounced} ≤ 2)`);

await browser.close();
console.log(
  `\n${fail ? "❌" : "🎯"} TEMPÊTE SESSION — pass=${pass} fail=${fail}`
);
process.exit(fail ? 1 : 0);
