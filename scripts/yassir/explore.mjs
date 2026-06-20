// Explorateur : se connecte au Chrome déjà ouvert (CDP) et espionne le réseau
// pour repérer l'API de prix de Yassir Mobility.
import { chromium } from "playwright-core";

const PICKUP = { lat: 36.7156191, lng: 5.0710866 }; // Bejaia (du lien fourni)
const DEST = { lat: 36.7525297, lng: 5.085492 };

const url =
  `https://mobility-app.yassir.com/fr?/?pickup=${PICKUP.lat},${PICKUP.lng}` +
  `&destination=${DEST.lat},${DEST.lng}`;

const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const ctx = browser.contexts()[0];
console.log(
  "contexts:",
  browser.contexts().length,
  "pages:",
  ctx.pages().length
);

const page = ctx.pages()[0] ?? (await ctx.newPage());

const hits = [];
page.on("response", async (res) => {
  const u = res.url();
  if (!/yassir|api|price|estimate|fare|quote|trip|ride|eta|route/i.test(u))
    return;
  let body = null;
  try {
    const ct = res.headers()["content-type"] || "";
    if (ct.includes("json")) body = await res.json();
  } catch {}
  const txt = body ? JSON.stringify(body) : "";
  if (
    /price|fare|amount|cost|estimate|eta|distance|duration|currency|dzd/i.test(
      txt + u
    )
  ) {
    hits.push({
      url: u,
      status: res.status(),
      keys: body ? Object.keys(body) : [],
      sample: txt.slice(0, 600),
    });
  }
});

console.log("navigating:", url);
await page
  .goto(url, { waitUntil: "domcontentloaded", timeout: 60000 })
  .catch((e) => console.log("goto err", e.message));
await page.waitForTimeout(12000);
console.log("final url:", page.url());
console.log("title:", await page.title());
console.log("=== price-related responses:", hits.length, "===");
for (const h of hits) {
  console.log("\n---", h.status, h.url);
  console.log("keys:", h.keys.join(","));
  console.log(h.sample);
}
await browser.close().catch(() => {});
