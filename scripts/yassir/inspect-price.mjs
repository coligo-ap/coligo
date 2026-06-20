import { CDP, findYassirPage } from "./cdp.mjs";
import { readFileSync, writeFileSync } from "node:fs";
const geo = JSON.parse(readFileSync("scripts/yassir/geo-cache3.json", "utf8"));
const enc = (lat, lng) => `${lat}%2C${lng}`;
const mk = (a, b) =>
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
const cdp = await CDP.attach(t.webSocketDebuggerUrl);
await cdp.send("Page.enable");
await cdp.send("Runtime.enable");
const ev = async (e) =>
  (await cdp.send("Runtime.evaluate", { expression: e, returnByValue: true }))
    .result.value;

for (const [lbl, ak, bk] of [
  ["COURT centre→gare", "centre", "gare"],
  ["MOYEN centre→tichy", "centre", "tichy"],
  ["LONG centre→akbou", "centre", "akbou"],
]) {
  await cdp.send("Page.navigate", { url: mk(geo[ak], geo[bk]) });
  await sleep(13000);
  // pour chaque élément contenant "DZD", dump texte + style (barré ? gras ? couleur ?)
  const dump = await ev(`(()=>{
    const els=[...document.querySelectorAll('*')].filter(e=>e.children.length===0 && /DZD/.test(e.textContent));
    return JSON.stringify(els.slice(0,12).map(e=>{const s=getComputedStyle(e);return{txt:e.textContent.trim(),strike:s.textDecorationLine,weight:s.fontWeight,size:s.fontSize,color:s.color};}));
  })()`);
  console.log("\n===" + lbl + "===");
  const arr = JSON.parse(dump);
  for (const x of arr)
    console.log(
      `  "${x.txt}" | barré=${x.strike} | poids=${x.weight} | taille=${x.size} | ${x.color}`
    );
  await sleep(7000);
}
cdp.close();
process.exit(0);
