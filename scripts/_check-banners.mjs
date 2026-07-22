/**
 * Contrôle des bannières promo d'une fiche commerçant :
 *   - le texte NE PASSE PAS sous l'illustration / la bande de produits,
 *   - rien n'est coupé (titre, sous-titre, bouton tiennent dans la carte),
 *   - montage des cartes pour la vérification visuelle.
 *
 *   node scripts/_check-banners.mjs <slug,slug,…> <sortie.jpg>
 */
import { chromium } from "playwright";
import sharp from "sharp";

const slugs = process.argv[2].split(",");
const out = process.argv[3];
const base = process.env.BASE_URL ?? "http://localhost:3000";
const width = Number(process.env.VW ?? 412);

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width, height: 900 },
  deviceScaleFactor: 2,
});

const shots = [];
let problems = 0;

for (const slug of slugs) {
  await page.goto(`${base}/m/${slug}`, {
    waitUntil: "domcontentloaded",
    timeout: 180000,
  });
  await page.waitForTimeout(3000);
  const cards = page.locator("section:has(h2) button:has(article)");
  const n = await cards.count();
  for (let i = 0; i < n; i++) {
    const card = cards.nth(i);
    // La bande défile horizontalement : sans ça, la 2e carte est hors cadre et
    // la capture attrape la page au lieu de l'élément.
    await card.scrollIntoViewIfNeeded();
    await page.waitForTimeout(400);
    const report = await card.evaluate((btn) => {
      const article = btn.querySelector("article");
      const text = article.querySelector("div.absolute.inset-y-0.left-0");
      const art = article.querySelector('img[src^="/promo/"]');
      const strip = article.querySelector("div.absolute.inset-y-0.right-0");
      const title = text.querySelector("h3");
      const sub = text.querySelector("p");
      const rect = (el) => (el ? el.getBoundingClientRect() : null);
      const t = rect(text);
      const decoration = rect(art) ?? rect(strip);
      const overlapPx = decoration ? Math.max(0, t.right - decoration.left) : 0;
      const clipped =
        text.scrollHeight > text.clientHeight + 1 ||
        title.scrollHeight > title.clientHeight + 1;
      return {
        titre: title.textContent.trim(),
        taillePolice: getComputedStyle(title).fontSize,
        sousTitre: sub ? sub.textContent.trim().slice(0, 40) : null,
        chevauchementPx: Math.round(overlapPx),
        coupe: clipped,
      };
    });
    if (report.chevauchementPx > 0 || report.coupe) problems++;
    console.log(
      `${report.chevauchementPx > 0 || report.coupe ? "❌" : "✅"} ${slug} · ${report.titre} · ${report.taillePolice} · chevauchement ${report.chevauchementPx}px · coupé ${report.coupe}`
    );
    shots.push(await card.screenshot());
  }
}
await browser.close();

// Montage vertical des cartes capturées.
const metas = await Promise.all(shots.map((b) => sharp(b).metadata()));
const W = Math.max(...metas.map((m) => m.width));
const H = metas.reduce((s, m) => s + m.height + 8, 0);
await sharp({
  create: { width: W, height: H, channels: 3, background: "#111" },
})
  .composite(
    shots.map((input, i) => ({
      input,
      left: 0,
      top: metas.slice(0, i).reduce((s, m) => s + m.height + 8, 0),
    }))
  )
  .jpeg({ quality: 82 })
  .toFile(out);

console.log(`\n${shots.length} cartes · ${problems} problème(s) → ${out}`);
process.exit(problems ? 1 : 0);
