import { CDP, findYassirPage } from "./cdp.mjs";
import { readFileSync, writeFileSync, appendFileSync } from "node:fs";
const geo = JSON.parse(readFileSync("scripts/yassir/geo-cache.json", "utf8"));
const enc = (lat, lng) => `${lat}%2C${lng}`;
const buildUrl = (a, b) =>
  "https://mobility-app.yassir.com/fr?%2F%3Fpickup=" +
  enc(a.lat, a.lng) +
  "&pickup=" +
  enc(a.lat, a.lng) +
  "&pickupPlaceid=" +
  a.place_id +
  "&destination=" +
  enc(b.lat, b.lng) +
  "&destinationPlaceid=" +
  b.place_id;
const LOG = "scripts/yassir/diag2.log";
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

appendFileSync(
  LOG,
  `\nDIAG2 start ${new Date().toISOString()} — cooldown 210s\n`
);
await sleep(210000);

const t = await findYassirPage();
const cdp = await CDP.attach(t.webSocketDebuggerUrl);
await cdp.send("Page.enable");
await cdp.send("Runtime.enable");
const state = async () =>
  (
    await cdp.send("Runtime.evaluate", {
      expression: `(() => {
    const inps=[...document.querySelectorAll('input')].map(i=>i.value).filter(Boolean);
    const txt=document.body.innerText;
    const m=txt.match(/Classique\\s*\\n\\s*([\\d\\s]+)DZD(?:\\s*\\n\\s*([\\d\\s]+)DZD)?/);
    return JSON.stringify({ inputs: inps.slice(0,4), hasUndefined: /undefined/.test(txt), classique: m? m[0].replace(/\\n/g,' ') : null, hasPrices: /DZD/.test(txt) });
  })()`,
      returnByValue: true,
    })
  ).result.value;

for (const [ak, bk] of [
  ["centre", "gare"],
  ["centre", "tichy"],
  ["centre", "akbou"],
]) {
  const a = geo[ak],
    b = geo[bk];
  await cdp.send("Page.navigate", { url: buildUrl(a, b) });
  await sleep(22000);
  const s = await state();
  const line = `${ak}→${bk}: ${s}`;
  console.log(line);
  appendFileSync(LOG, line + "\n");
  const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(
    `scripts/yassir/d2_${bk}.png`,
    Buffer.from(shot.data, "base64")
  );
  await sleep(8000);
}
cdp.close();
process.exit(0);
