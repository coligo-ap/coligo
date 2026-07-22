/**
 * Contrôle de la bande d'offres d'une fiche commerçant :
 *   - capture de la carte bannière,
 *   - ouverture de la feuille de détail,
 *   - VÉRIFICATION que le défilement reste DANS la feuille (la page derrière
 *     ne doit pas bouger).
 *
 *   node scripts/_check-offer-sheet.mjs <slug> <dossier-sortie>
 */
import { chromium } from "playwright";

const slug = process.argv[2];
const outDir = process.argv[3];
const base = process.env.BASE_URL ?? "http://localhost:3000";

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 412, height: Number(process.env.VH ?? 900) },
  deviceScaleFactor: 2,
  hasTouch: true,
  isMobile: true,
});
await page.goto(`${base}/m/${slug}`, {
  waitUntil: "domcontentloaded",
  timeout: 180000,
});
await page.waitForSelector("article", { timeout: 60000 });
await page.waitForTimeout(2500);

// 1. La carte bannière (section « Offres & réductions »).
const card = page.locator("section:has(h2) button:has(article)").first();
await card.screenshot({ path: `${outDir}/banner-card.png` });

// 2. Ouverture de la feuille.
await card.click();
await page.waitForSelector('[role="dialog"]', { timeout: 15000 });
await page.waitForTimeout(700);
await page.screenshot({ path: `${outDir}/sheet-open.png` });

// 3. Défilement DANS la feuille.
const before = await page.evaluate(() => window.scrollY);
const scroller = page.locator('[role="dialog"] .overflow-y-auto').first();
const box = await scroller.boundingBox();
await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
await page.mouse.wheel(0, 400);
await page.waitForTimeout(600);

const after = await page.evaluate(() => window.scrollY);
const sheetScroll = await scroller.evaluate((el) => ({
  top: el.scrollTop,
  scrollable: el.scrollHeight > el.clientHeight + 1,
}));
const bodyLocked = await page.evaluate(
  () => getComputedStyle(document.body).overflow
);
await page.screenshot({ path: `${outDir}/sheet-scrolled.png` });

console.log(
  JSON.stringify(
    {
      pageScrollAvant: before,
      pageScrollApres: after,
      pageABouge: before !== after,
      feuilleDefilable: sheetScroll.scrollable,
      feuilleScrollTop: sheetScroll.top,
      bodyOverflow: bodyLocked,
    },
    null,
    1
  )
);
await browser.close();
