import { CDP, findYassirPage } from "./cdp.mjs";
import { writeFileSync } from "node:fs";

const PICKUP = { lat: 36.7156191, lng: 5.0710866 };
const DEST = { lat: 36.7525297, lng: 5.085492 };
const tripUrl =
  `https://mobility-app.yassir.com/fr?/?pickup=${PICKUP.lat},${PICKUP.lng}` +
  `&destination=${DEST.lat},${DEST.lng}`;

const t = await findYassirPage();
const cdp = await CDP.attach(t.webSocketDebuggerUrl);
await cdp.send("Network.enable");
await cdp.send("Page.enable");

const reqMeta = new Map(); // id -> {url, method, post, type}
const xhr = []; // collected XHR/Fetch responses

cdp.on((method, params) => {
  if (method === "Network.requestWillBeSent") {
    reqMeta.set(params.requestId, {
      url: params.request.url,
      method: params.request.method,
      post: params.request.postData || null,
      headers: params.request.headers,
    });
  }
  if (method === "Network.responseReceived") {
    if (params.type === "XHR" || params.type === "Fetch") {
      const m = reqMeta.get(params.requestId) || {};
      xhr.push({
        requestId: params.requestId,
        url: params.response.url,
        status: params.response.status,
        method: m.method,
        post: m.post,
        headers: m.headers,
      });
    }
  }
});

console.log("navigate:", tripUrl);
await cdp.send("Page.navigate", { url: tripUrl });
await new Promise((r) => setTimeout(r, 18000));

const out = [];
for (const x of xhr) {
  let body = "";
  try {
    const b = await cdp.send("Network.getResponseBody", {
      requestId: x.requestId,
    });
    body = b.body || "";
  } catch (e) {
    body = "<no-body:" + e.message + ">";
  }
  out.push({ ...x, body });
}
writeFileSync("scripts/yassir/xhr-dump.json", JSON.stringify(out, null, 2));
console.log("XHR/Fetch captured:", out.length);
for (const x of out) {
  console.log("\n", x.status, x.method, x.url);
  if (
    /price|fare|cost|estimate|service|product|vehicle|trip|eta|distance|duration|dzd/i.test(
      x.url + x.body
    )
  ) {
    console.log("  >> BODY:", x.body.slice(0, 500).replace(/\s+/g, " "));
  }
}
cdp.close();
process.exit(0);
