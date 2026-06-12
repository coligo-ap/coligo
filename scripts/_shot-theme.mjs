// Capture light/dark de la marketplace client (vérif visuelle du thème).
import { chromium } from "playwright";
import { mkdirSync } from "node:fs";

const BASE = process.env.BASE ?? "http://localhost:3000";
const OUT = "./playwright-shots";
mkdirSync(OUT, { recursive: true });

const b = await chromium.launch({ headless: true });
for (const theme of ["light", "dark"]) {
  const ctx = await b.newContext({
    viewport: { width: 390, height: 844 },
    deviceScaleFactor: 2,
  });
  if (theme === "dark") {
    await ctx.addCookies([
      {
        name: "coligo_theme",
        value: "dark",
        url: BASE,
      },
    ]);
  }
  const p = await ctx.newPage();
  for (const [path, name] of [
    ["/", "home"],
    ["/search", "search"],
    ["/cart", "cart"],
  ]) {
    await p
      .goto(BASE + path, { waitUntil: "domcontentloaded", timeout: 90000 })
      .catch(() => {});
    await p.waitForTimeout(3500);
    await p
      .screenshot({
        path: `${OUT}/theme-${name}-${theme}.png`,
        timeout: 20000,
      })
      .catch((e) => console.log("skip", name, e.message.split("\n")[0]));
    console.log("shot", `theme-${name}-${theme}`);
  }
  await ctx.close();
}
await b.close();
