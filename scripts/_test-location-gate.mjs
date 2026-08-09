// Garde « localisation obligatoire » (chauffeur + livreur) — vérification bout
// en bout dans un vrai navigateur.
//
//   BASE=http://localhost:3011 node scripts/_test-location-gate.mjs
//   BASE=https://coligo.app    node scripts/_test-location-gate.mjs
//
// ⚠ En LOCAL, lancer `next dev` avec les variables Supabase de PROD : sans quoi
// `.env.development.local` prend le dessus et pointe la base dev (en pause),
// où les comptes de test n'existent pas → « téléphone ou mot de passe
// incorrect » qui n'a rien à voir avec la garde testée ici.
//
// Quatre contrôles par espace :
//   1. AUCUNE permission            → écran bloquant.
//   2. Mise HORS LIGNE forcée       → l'intention « en ligne » posée avant le
//                                     chargement doit avoir été remise à 0.
//   3. Permission accordée À CHAUD  → l'écran disparaît SANS rechargement
//                                     (le partenaire revient des réglages).
//   4. Permission dès le départ     → jamais de blocage.
//
// Les attentes sont des SONDAGES avec échéance, jamais des `waitForTimeout`
// fixes : en dev, la première compilation d'une route coûte plusieurs secondes
// et rendait le résultat aléatoire d'un espace à l'autre.
import { chromium } from "playwright";

const BASE = process.env.BASE ?? "http://localhost:3011";
const PHONE = process.env.QA_PHONE ?? "0603044618";
const PASS = process.env.QA_PASS ?? PHONE;
// Alger centre — position injectée quand on accorde la permission.
const POS = { latitude: 36.7538, longitude: 3.0588 };
/** Échéance des sondages (compilation dev + grâce du hook comprises). */
const DEADLINE_MS = 60_000;

const SPACES = [
  {
    key: "chauffeur",
    login: "/chauffeur/login",
    home: "/chauffeur",
    onlineKey: "coligo-drive-online",
  },
  {
    key: "livreur",
    login: "/driver/login",
    home: "/driver",
    onlineKey: "coligo_driver_online",
  },
];

/** Titre de l'écran bloquant, dans ses deux formulations. */
const BLOCK_RE = /Localisation obligatoire|Activez la localisation/i;

let failures = 0;
function check(name, ok, detail = "") {
  if (!ok) failures++;
  console.log(`${ok ? "OK  " : "KO  "} ${name}${detail ? ` — ${detail}` : ""}`);
}

/** Sonde `fn` jusqu'à ce qu'elle soit vraie, ou jusqu'à l'échéance. */
async function until(page, fn, deadline = DEADLINE_MS) {
  const stop = Date.now() + deadline;
  for (;;) {
    try {
      if (await fn()) return true;
    } catch {
      /* navigation en cours — on retente */
    }
    if (Date.now() > stop) return false;
    await page.waitForTimeout(1000);
  }
}

const blockVisible = (page) => async () =>
  BLOCK_RE.test(await page.locator("body").innerText());
const blockGone = (page) => async () =>
  !BLOCK_RE.test(await page.locator("body").innerText());

async function login(page, space) {
  await page.goto(BASE + space.login, {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });
  const ready = await until(
    page,
    async () => (await page.locator('input[type="tel"]').count()) > 0,
    30_000
  );
  if (!ready) return false;
  await page.fill('input[type="tel"]', PHONE);
  await page.fill('input[type="password"]', PASS);
  await page.click('button[type="submit"]');
  // Connecté = on a quitté la page de login.
  return until(page, async () => !page.url().includes("login"), 45_000);
}

const browser = await chromium.launch({ headless: true });

for (const space of SPACES) {
  // ── 1 & 2. Sans permission : blocage + mise hors ligne ────────────────────
  const ctx = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: "fr-DZ",
    // Aucune permission accordée : Chromium refuse la géolocalisation.
    permissions: [],
  });
  // On se DÉCLARE en ligne avant tout chargement : la garde doit le défaire.
  await ctx.addInitScript(
    ([k]) => {
      try {
        localStorage.setItem(k, "1");
      } catch {}
    },
    [space.onlineKey]
  );
  const page = await ctx.newPage();

  if (!(await login(page, space))) {
    check(`${space.key}: connexion`, false, "login impossible");
    await ctx.close();
    continue;
  }
  await page.goto(BASE + space.home, {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });

  check(
    `${space.key}: bloqué sans permission`,
    await until(page, blockVisible(page))
  );

  const offline = await until(
    page,
    async () =>
      (await page.evaluate((k) => localStorage.getItem(k), space.onlineKey)) !==
      "1",
    20_000
  );
  check(`${space.key}: mis hors ligne`, offline);

  // ── 3. Permission accordée À CHAUD : l'écran doit disparaître seul ────────
  await ctx.grantPermissions(["geolocation"], { origin: BASE });
  await ctx.setGeolocation(POS);
  check(
    `${space.key}: déblocage à chaud sans reload`,
    await until(page, blockGone(page))
  );
  await ctx.close();

  // ── 4. Permission dès le départ : jamais de blocage ───────────────────────
  const ctx2 = await browser.newContext({
    viewport: { width: 390, height: 844 },
    locale: "fr-DZ",
    permissions: ["geolocation"],
    geolocation: POS,
  });
  const page2 = await ctx2.newPage();
  if (!(await login(page2, space))) {
    check(`${space.key}: connexion (avec position)`, false, "login impossible");
    await ctx2.close();
    continue;
  }
  await page2.goto(BASE + space.home, {
    waitUntil: "domcontentloaded",
    timeout: 120000,
  });
  // On laisse largement le temps à un blocage FAUTIF d'apparaître.
  await page2.waitForTimeout(20_000);
  check(
    `${space.key}: pas de blocage avec position`,
    !BLOCK_RE.test(await page2.locator("body").innerText())
  );
  await ctx2.close();
}

await browser.close();
console.log(
  failures === 0
    ? "\n✅ garde de localisation conforme"
    : `\n❌ ${failures} cas KO`
);
process.exit(failures === 0 ? 0 : 1);
