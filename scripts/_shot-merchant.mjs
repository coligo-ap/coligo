/** Capture d'écran d'une fiche commerçant : node scripts/_shot-merchant.mjs <slug> <sortie.png> */
import { chromium } from "playwright";

const slug = process.argv[2];
const out = process.argv[3];
const base = process.env.BASE_URL ?? "http://localhost:3000";

const browser = await chromium.launch();
const page = await browser.newPage({
  viewport: { width: 412, height: 1400 },
  deviceScaleFactor: 2,
});
const errors = [];
page.on("console", (m) => {
  if (m.type() === "error") errors.push(m.text());
});
await page.goto(`${base}/m/${slug}`, {
  waitUntil: "domcontentloaded",
  timeout: 120000,
});
await page.waitForTimeout(6000);
await page.screenshot({ path: out, fullPage: false });
console.log("ok", out);
if (errors.length)
  console.log("ERREURS CONSOLE:\n" + errors.slice(0, 8).join("\n"));
await browser.close();
