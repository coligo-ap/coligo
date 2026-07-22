/**
 * Contrôle visuel des véhicules à proximité (mig 0400/0401).
 *
 *   node scripts/_check-drive-vehicles.mjs <dossier-sortie> [lat] [lng]
 *
 * N'ÉCRIT RIEN en base : depuis la mig 0401 les bots de démonstration sont
 * placés autour du point demandé, donc le test fonctionne à N'IMPORTE QUELLE
 * adresse sans toucher à la présence des chauffeurs réels.
 *
 * Vérifie : l'écran des gammes s'ouvre, les sprites véhicule sont montés, leur
 * nombre correspond au décompte serveur pour la gamme sélectionnée, la moto
 * apparaît bien avec son propre visuel, et les véhicules BOUGENT.
 */
import { chromium } from "playwright";
import { loadEnvLocal } from "./_supabase.mjs";

loadEnvLocal();
const BASE = process.env.BASE_URL ?? "http://localhost:3000";
const OUT = process.argv[2] ?? ".";
const PICKUP = {
  lat: Number(process.argv[3] ?? 36.7551),
  lng: Number(process.argv[4] ?? 5.0821),
};
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
    geolocation: { latitude: PICKUP.lat, longitude: PICKUP.lng },
    permissions: ["geolocation"],
    locale: "fr-FR",
  });
  const page = await ctx.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(e.message.slice(0, 160)));

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
  await page.waitForTimeout(2000);
  await page.screenshot({ path: `${OUT}/drive-accueil.png` });

  // Le bouton « Continuer » exige un DÉPART résolu (GPS) ET une destination :
  // on attend l'adresse de départ avant de choisir la destination.
  await page
    .getByText(/Ma position actuelle/i)
    .first()
    .waitFor({ timeout: 60000 })
    .catch(() => {});
  // Première destination RÉCENTE, quelle qu'elle soit : la liste dépend de
  // l'historique du compte de test, s'accrocher à un libellé la rend fragile.
  const recent = page.locator('button:below(:text("Continuer"))').first();
  if (await recent.count()) {
    await recent.click();
    await page.waitForTimeout(2000);
  }
  // « Continuer » reste DÉSACTIVÉ tant que la destination n'est pas résolue :
  // on attend qu'il soit réellement actionnable plutôt que de cliquer à l'aveugle.
  const go = page.getByRole("button", { name: /Continuer/i }).first();
  for (let i = 0; i < 60 && !(await go.isEnabled().catch(() => false)); i++) {
    await page.waitForTimeout(1000);
  }
  await go.click();
  await page
    .getByText(/Classic|Confort/i)
    .first()
    .waitFor({ timeout: 120000 })
    .catch(() => {});

  // ── Gamme par gamme : le décompte serveur doit correspondre à l'écran.
  for (const gamme of ["Classic", "Confort", "Moto"]) {
    const tile = page.getByText(gamme, { exact: true }).first();
    if (!(await tile.count())) continue;
    await tile.click();
    await page
      .locator('img[src*="/drive/vehicles/"]')
      .first()
      .waitFor({ timeout: 20000 })
      .catch(() => {});
    const expected = await page.evaluate(
      async (g) => {
        const r = await fetch(
          `/api/drive/nearby-vehicles?lat=${g.lat}&lng=${g.lng}&gamme=${g.key}`,
          { cache: "no-store" }
        );
        return (await r.json()).vehicles.length;
      },
      { lat: PICKUP.lat, lng: PICKUP.lng, key: gamme.toLowerCase() }
    );
    // On ATTEND la convergence (le relevé suivant, ≤ 7 s) au lieu de dormir un
    // délai arbitraire : sinon on compte encore les véhicules de la gamme
    // précédente et le test accuse à tort.
    let shown = await page.locator("[data-veh]").count();
    for (let i = 0; i < 30 && shown !== expected; i++) {
      await page.waitForTimeout(1000);
      shown = await page.locator("[data-veh]").count();
    }
    const moto = await page.locator('img[src*="moto-coligo"]').count();
    check(
      `gamme ${gamme} : ${shown} véhicule(s) affiché(s)`,
      shown > 0 && Math.abs(shown - expected) <= 1,
      `serveur ${expected}${gamme === "Moto" ? ` · visuel moto ${moto}` : ""}`
    );
    if (gamme === "Moto") {
      check("visuel MOTO utilisé", moto > 0, `${moto} sprite(s)`);
    }
    await page.screenshot({ path: `${OUT}/gamme-${gamme.toLowerCase()}.png` });
  }

  // ── Mouvement : on compare le CAP, pas les pixels. Sur un trajet très long
  // la carte est dézoomée et 80 m de déplacement tiennent dans un pixel — le
  // test dirait « immobile » alors que le véhicule roule.
  const posOf = () =>
    page
      .locator("[data-veh]")
      .first()
      .evaluate((el) => el.style.transform)
      .catch(() => null);
  // Deux relevés séparés par PLUS d'un cycle : on accepte un changement de cap
  // OU de position (sur une carte très dézoomée, 80 m tiennent dans un pixel).
  const snap = async () => ({
    rot: await posOf(),
    pos: await page
      .locator(".maplibregl-marker:has([data-veh])")
      .first()
      .evaluate((el) => el.style.transform)
      .catch(() => null),
  });
  const s1 = await snap();
  await page.waitForTimeout(16000);
  const s2 = await snap();
  const bougé =
    (s1.rot && s2.rot && s1.rot !== s2.rot) ||
    (s1.pos && s2.pos && s1.pos !== s2.pos);
  check("les véhicules se déplacent", !!bougé, `${s1.rot} → ${s2.rot}`);

  check(
    "aucune erreur JS",
    errors.length === 0,
    errors.slice(0, 2).join(" | ")
  );
  console.log(`\n${pass} succès, ${fail} échec(s)`);
} finally {
  await browser.close();
}
process.exit(fail ? 1 : 0);
