import { CDP, findYassirPage } from "./cdp.mjs";
import { readFileSync, writeFileSync } from "node:fs";
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
const ev = async (expr) =>
  (
    await cdp.send("Runtime.evaluate", {
      expression: expr,
      returnByValue: true,
    })
  ).result.value;

await cdp.send("Page.navigate", { url });
await sleep(14000);
console.log(
  "prix base:",
  await ev(
    `(document.body.innerText.match(/Classique\\s*\\n\\s*[\\d\\s]+DZD/)||[null])[0]`
  )
);

// chercher le bouton de planification
const btns = await ev(
  `JSON.stringify([...document.querySelectorAll('button,[role=button],a')].map(b=>b.innerText.trim()).filter(x=>x && x.length<40))`
);
console.log("boutons:", btns);

// cliquer "Ajouter une date" / "plus tard" / "programm"
const clicked = await ev(`(() => {
  const el=[...document.querySelectorAll('button,[role=button],a,div')].find(b=>/ajouter une date|plus tard|programm|réserver pour|planifier|date/i.test(b.innerText||''));
  if(el){el.click();return el.innerText.trim();} return null;
})()`);
console.log("cliqué:", clicked);
await sleep(3000);
const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
writeFileSync("scripts/yassir/sched.png", Buffer.from(shot.data, "base64"));
const after = await ev(
  `JSON.stringify({ inputs:[...document.querySelectorAll('input,select')].map(i=>({type:i.type,val:i.value,ph:i.placeholder})), text: document.body.innerText.slice(0,1200) })`
);
console.log("après clic:", after);
cdp.close();
process.exit(0);
