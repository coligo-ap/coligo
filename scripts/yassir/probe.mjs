import { CDP, findYassirPage } from "./cdp.mjs";
import { readFileSync } from "node:fs";
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
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const t = await findYassirPage();
if (!t) {
  console.log("PAS DE PAGE YASSIR — ouvre un onglet mobility-app.yassir.com");
  process.exit(0);
}
const cdp = await CDP.attach(t.webSocketDebuggerUrl);
await cdp.send("Page.enable");
await cdp.send("Runtime.enable");
const state = async () =>
  (
    await cdp.send("Runtime.evaluate", {
      expression: `(() => { const inps=[...document.querySelectorAll('input')].map(i=>i.value).filter(Boolean); const txt=document.body.innerText; const m=txt.match(/(Classique|Confort)[\\s\\S]{0,40}?DZD[\\s\\S]{0,40}?DZD/g); return JSON.stringify({inputs:inps.slice(0,3), prices:m, undef:/undefined/.test(txt)}); })()`,
      returnByValue: true,
    })
  ).result.value;
for (const [ak, bk] of [
  ["centre", "tichy"],
  ["centre", "aokas"],
  ["centre", "akbou"],
]) {
  await cdp.send("Page.navigate", { url: buildUrl(geo[ak], geo[bk]) });
  await sleep(20000);
  console.log(`${ak}→${bk}:`, await state());
  await sleep(6000);
}
cdp.close();
process.exit(0);
