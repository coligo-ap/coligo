import { CDP, findYassirPage } from "./cdp.mjs";
import { readFileSync, writeFileSync } from "node:fs";
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

const t = await findYassirPage();
const cdp = await CDP.attach(t.webSocketDebuggerUrl);
await cdp.send("Page.enable");
await cdp.send("Runtime.enable");
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const innerText = async () =>
  (
    await cdp.send("Runtime.evaluate", {
      expression: "document.body.innerText",
      returnByValue: true,
    })
  ).result.value || "";

const tests = [
  ["centre", "tichy"],
  ["centre", "aokas"],
  ["centre", "el_kseur"],
  ["centre", "sidi_aich"],
  ["centre", "akbou"],
];
for (const [ak, bk] of tests) {
  const a = geo[ak],
    b = geo[bk];
  await cdp.send("Page.navigate", { url: buildUrl(a, b) });
  await sleep(30000); // long wait
  const text = await innerText();
  const block =
    text.split("Sélectionnez un type de course")[1] || text.slice(-600);
  console.log(`\n===== ${ak}→${bk} =====`);
  console.log(block.replace(/\n{2,}/g, "\n").slice(0, 700));
  const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
  writeFileSync(
    `scripts/yassir/long_${bk}.png`,
    Buffer.from(shot.data, "base64")
  );
  await sleep(4000);
}
cdp.close();
process.exit(0);
