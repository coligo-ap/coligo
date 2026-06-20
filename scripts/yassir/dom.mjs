import { CDP, findYassirPage } from "./cdp.mjs";
import { writeFileSync } from "node:fs";

const PICKUP = process.argv[2] || "36.7156191,5.0710866";
const DEST = process.argv[3] || "36.7525297,5.085492";
const tripUrl = `https://mobility-app.yassir.com/fr?/?pickup=${PICKUP}&destination=${DEST}`;

const t = await findYassirPage();
const cdp = await CDP.attach(t.webSocketDebuggerUrl);
await cdp.send("Page.enable");
await cdp.send("Runtime.enable");
await cdp.send("Page.navigate", { url: tripUrl });
await new Promise((r) => setTimeout(r, 16000));

const r = await cdp.send("Runtime.evaluate", {
  expression: "document.body.innerText",
  returnByValue: true,
});
const text = r.result.value || "";
console.log("===== PAGE TEXT =====");
console.log(text.slice(0, 3000));

// screenshot
const shot = await cdp.send("Page.captureScreenshot", { format: "png" });
writeFileSync("scripts/yassir/shot.png", Buffer.from(shot.data, "base64"));
console.log("\n[screenshot saved scripts/yassir/shot.png]");
cdp.close();
process.exit(0);
