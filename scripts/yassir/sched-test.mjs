import { CDP, findYassirPage } from "./cdp.mjs";
import { readFileSync } from "node:fs";
const geo = JSON.parse(readFileSync("scripts/yassir/geo-cache3.json", "utf8"));
const enc = (lat, lng) => `${lat}%2C${lng}`;
const a = geo.centre,
  b = geo.tichy;
const url =
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
const priceOf = async () =>
  await ev(
    `(()=>{const m=document.body.innerText.match(/Classique\\s*\\n\\s*([\\d\\s]+)DZD/);return m?+m[1].replace(/\\s/g,''):null;})()`
  );

async function schedule(day, hour, minute) {
  // ré-ouvre le picker
  await ev(
    `(()=>{const el=[...document.querySelectorAll("button,[role=button]")].find(b=>b.innerText.trim()==="Ajouter une date");if(el)el.click();})()`
  );
  await sleep(1500);
  // colonnes : repère les x des cellules numériques
  const layout = await ev(`(()=>{
    const cells=[...document.querySelectorAll("*")].filter(e=>e.children.length===0 && /^\\d{1,2}$/.test(e.textContent.trim()));
    const data=cells.map(e=>{const r=e.getBoundingClientRect();return{t:e.textContent.trim(),x:Math.round(r.x),y:Math.round(r.y),w:Math.round(r.width)};}).filter(c=>c.w>0);
    const xs=[...new Set(data.map(c=>c.x))].sort((a,b)=>a-b);
    return JSON.stringify({xs, data});
  })()`);
  const { xs, data } = JSON.parse(layout);
  // colonnes heure/minute = les 2 x les plus à droite ayant >=10 cellules
  const byX = {};
  for (const c of data) {
    (byX[c.x] ??= []).push(c.t);
  }
  const tallX = Object.keys(byX)
    .filter((x) => byX[x].length >= 10)
    .map(Number)
    .sort((a, b) => a - b);
  const hourX = tallX[tallX.length - 2],
    minX = tallX[tallX.length - 1];
  const calMaxX = Math.min(hourX, minX) - 5;
  const clickCell = async (text, xMin, xMax) => {
    const ok = await ev(
      `(()=>{const c=[...document.querySelectorAll("*")].filter(e=>e.children.length===0 && e.textContent.trim()===${JSON.stringify(String(text))});for(const e of c){const r=e.getBoundingClientRect();if(r.x>=${xMin}&&r.x<=${xMax}&&r.width>0){e.scrollIntoView({block:'center'});e.click();return true;}}return false;})()`
    );
    await sleep(500);
    return ok;
  };
  const d = await clickCell(day, 0, calMaxX);
  const h = await clickCell(hour, hourX - 8, hourX + 8);
  const mi = await clickCell(minute, minX - 8, minX + 8);
  await ev(
    `(()=>{const el=[...document.querySelectorAll("button")].find(b=>/Appliquer/i.test(b.innerText));if(el)el.click();})()`
  );
  await sleep(6000);
  return { d, h, mi };
}

await cdp.send("Page.navigate", { url });
await sleep(14000);
const base = await priceOf();
console.log("BASE (samedi ~13h) Classique:", base);

for (const [lbl, day, hour, min] of [
  ["lundi 18h", "22", "18", "00"],
  ["lundi 03h (nuit)", "22", "3", "00"],
  ["lundi 13h", "22", "13", "00"],
]) {
  const r = await schedule(day, hour, min);
  const p = await priceOf();
  console.log(
    `${lbl} → sélection(jour=${r.d},h=${r.h},min=${r.mi}) prix=${p}  ${base && p ? (p === base ? "= base (pas de surge programmé)" : (((p - base) / base) * 100).toFixed(0) + "% vs base") : ""}`
  );
  await sleep(2000);
}
cdp.close();
process.exit(0);
