/**
 * Contrôle visuel des véhicules à proximité (mig 0400) : met quelques
 * chauffeurs EN LIGNE autour d'un point, ouvre l'écran des gammes côté client,
 * capture — puis REMET la présence dans son état initial.
 *
 *   node scripts/_check-drive-vehicles.mjs <dossier-sortie>
 */
import { chromium } from "playwright";
import pg from "pg";
import { getDbUrl, loadEnvLocal } from "./_supabase.mjs";

loadEnvLocal();
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.argv[2] ?? ".";
const EMAIL = "qawaexpress@gmail.com";
// Béjaïa centre — là où vivent les commerçants de démonstration.
const PICKUP = { lat: 36.7551, lng: 5.0821 };

const db = new pg.Client({
  connectionString: getDbUrl(),
  ssl: { rejectUnauthorized: false },
});
await db.connect();

const { rows: chs } = await db.query(
  `select id, gamme from public.chauffeurs
    where is_verified and not is_frozen and not is_blocked
    order by case when gamme = 'moto' then 0 else 1 end
    limit 5`
);
const before = new Map();
for (const ch of chs) {
  const { rows } = await db.query(
    "select lat, lng, is_online, heading from public.chauffeur_presence where chauffeur_id = $1",
    [ch.id]
  );
  before.set(ch.id, rows[0] ?? null);
}

let browser;
try {
  // Positions en éventail autour du départ, caps variés (dont 350° pour voir
  // la rotation par le plus court arc au relevé suivant).
  const caps = [10, 95, 180, 265, 350];
  let i = 0;
  for (const ch of chs) {
    await db.query(
      `insert into public.chauffeur_presence (chauffeur_id, lat, lng, is_online, updated_at, heading)
       values ($1, $2, $3, true, now(), $4)
       on conflict (chauffeur_id) do update
         set lat = excluded.lat, lng = excluded.lng, is_online = true,
             updated_at = now(), heading = excluded.heading`,
      [
        ch.id,
        PICKUP.lat + (i - 2) * 0.0016,
        PICKUP.lng + ((i % 3) - 1) * 0.0022,
        caps[i % caps.length],
      ]
    );
    i++;
  }
  console.log(`${chs.length} chauffeurs en ligne autour du départ`);

  browser = await chromium.launch();
  const ctx = await browser.newContext({
    viewport: { width: 412, height: 900 },
    geolocation: { latitude: PICKUP.lat, longitude: PICKUP.lng },
    permissions: ["geolocation"],
    locale: "fr-FR",
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 160)));
  let apiCalls = 0;
  const apiBodies = [];
  page.on("request", (r) => {
    if (r.url().includes("/api/drive/nearby-vehicles")) apiCalls++;
  });
  page.on("response", async (r) => {
    if (!r.url().includes("/api/drive/nearby-vehicles")) return;
    try {
      const j = await r.json();
      apiBodies.push(
        `${new URL(r.url()).searchParams.get("gamme") ?? "toutes"}:${j.vehicles.length}`
      );
    } catch {}
  });

  await page.goto(`${BASE}/se-connecter`, {
    waitUntil: "domcontentloaded",
    timeout: 180000,
  });
  await page.fill("#email", EMAIL);
  await page.fill("#password", EMAIL);
  await page.click('button[type="submit"]');
  await page.waitForTimeout(9000);

  await page.goto(`${BASE}/drive`, {
    waitUntil: "domcontentloaded",
    timeout: 180000,
  });
  // Attendre l'écran RÉEL (pas le squelette) : en dev la 1re compilation peut
  // dépasser n'importe quel délai fixe.
  await page
    .getByRole("button", { name: /Continuer/i })
    .first()
    .waitFor({ timeout: 120000 });
  await page.waitForTimeout(2500);
  await page.screenshot({ path: `${OUT}/drive-accueil.png` });

  // ── Écran des GAMMES : destination récente puis « Continuer ».
  const recent = page.getByText("Brise de Mer", { exact: true }).first();
  if (await recent.count()) {
    await recent.click();
    await page.waitForTimeout(2500);
  }
  const go = page.getByRole("button", { name: /Continuer/i }).first();
  if (await go.count()) {
    await go.click();
    // L'écran des gammes est prêt quand une gamme est listée.
    await page
      .getByText(/Classic|Confort/i)
      .first()
      .waitFor({ timeout: 120000 })
      .catch(() => {});
    // Puis on laisse au 1er relevé le temps d'arriver (poll 7 s).
    await page
      .locator('img[src*="/drive/vehicles/"]')
      .first()
      .waitFor({ timeout: 25000 })
      .catch(() => {});
  }
  // La carte de l'écran des gammes ne montre QUE la gamme sélectionnée : on
  // choisit Classic explicitement, puis on compare au décompte serveur pour
  // cette même gamme (sinon le test dépend du tirage des chauffeurs).
  const classic = page.getByText("Classic", { exact: true }).first();
  if (await classic.count()) {
    await classic.click();
    await page.waitForTimeout(1500);
  }
  await page
    .locator('img[src*="/drive/vehicles/"]')
    .first()
    .waitFor({ timeout: 25000 })
    .catch(() => {});
  const expected = await page.evaluate(async () => {
    const r = await fetch(
      "/api/drive/nearby-vehicles?lat=36.7551&lng=5.0821&gamme=classic",
      { cache: "no-store" }
    );
    return (await r.json()).vehicles.length;
  });
  console.log("attendu (gamme classic, serveur) :", expected);

  // Diagnostic : la route JSON répond-elle DANS la session du client ?
  const api = await page.evaluate(async () => {
    const r = await fetch("/api/drive/nearby-vehicles?lat=36.7551&lng=5.0821", {
      cache: "no-store",
    });
    return { status: r.status, body: (await r.text()).slice(0, 300) };
  });
  console.log("route JSON :", api.status, api.body);
  await page.screenshot({ path: `${OUT}/drive-gammes.png` });
  const sprites = await page.locator('img[src*="/drive/vehicles/"]').count();
  console.log(`sprites véhicule sur l'écran des gammes : ${sprites}`);
  // Cap réellement appliqué au 1er véhicule (preuve de l'orientation).
  const rot = await page
    .locator("[data-veh]")
    .first()
    .evaluate((el) => el.style.transform)
    .catch(() => "—");
  console.log("rotation du 1er véhicule :", rot);
  console.log("appels à la route JSON :", apiCalls, apiBodies.join(" "));
  console.log("noeuds [data-veh] :", await page.locator("[data-veh]").count());
  if (errors.length) console.log("ERREURS:\n" + errors.slice(0, 5).join("\n"));
} finally {
  for (const [id, prev] of before) {
    if (prev) {
      await db.query(
        `update public.chauffeur_presence
            set lat = $2, lng = $3, is_online = $4, heading = $5
          where chauffeur_id = $1`,
        [id, prev.lat, prev.lng, prev.is_online, prev.heading]
      );
    } else {
      await db.query(
        "delete from public.chauffeur_presence where chauffeur_id = $1",
        [id]
      );
    }
  }
  const { rows } = await db.query(
    "select count(*)::int n from public.chauffeur_presence where is_online"
  );
  console.log(`présence restaurée — ${rows[0].n} chauffeur(s) en ligne`);
  await db.end();
  if (browser) await browser.close();
}
