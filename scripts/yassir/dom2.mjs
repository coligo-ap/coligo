import { CDP, findYassirPage } from "./cdp.mjs";
import { writeFileSync } from "node:fs";

// URL d'origine COMPLÈTE (avec pickupPlaceid + destinationPlaceid)
const tripUrl =
  "https://mobility-app.yassir.com/fr?%2F%3Fpickup=36.7156191%2C5.0710866&pickup=36.7553028%2C5.0543396&pickupPlaceid=ChIJW6kJOgAzjRIRF2vMqBaJSPI&destination=36.7525297%2C5.085491999999999&destinationPlaceid=ChIJ9f-1ZZnM8hIRQsyfSEUYeoE";

const t = await findYassirPage();
const cdp = await CDP.attach(t.webSocketDebuggerUrl);
await cdp.send("Page.enable");
await cdp.send("Runtime.enable");
await cdp.send("Page.navigate", { url: tripUrl });

for (let i = 0; i < 6; i++) {
  await new Promise((r) => setTimeout(r, 5000));
  const r = await cdp.send("Runtime.evaluate", {
    expression: "document.body.innerText",
    returnByValue: true,
  });
  const text = r.result.value || "";
  console.log(`\n===== T+${(i + 1) * 5}s =====`);
  console.log(text.slice(0, 2500));
  if (/DA|DZD|prix|Standard|Confort|Économique|estim/i.test(text)) break;
}
const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
writeFileSync("scripts/yassir/shot2.png", Buffer.from(shot.data, "base64"));
console.log("\n[shot2.png saved]");
cdp.close();
process.exit(0);
