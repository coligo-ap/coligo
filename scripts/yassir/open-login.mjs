import { chromium } from "playwright-core";
const browser = await chromium.connectOverCDP("http://127.0.0.1:9222");
const ctx = browser.contexts()[0];
const page = ctx.pages()[0] ?? (await ctx.newPage());
await page
  .goto("https://mobility-app.yassir.com/fr/auth", {
    waitUntil: "domcontentloaded",
  })
  .catch(() => {});
await page.bringToFront();
console.log("login page ready:", page.url());
await browser.close().catch(() => {});
