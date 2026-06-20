import { CDP, findYassirPage } from "./cdp.mjs";

const PICKUP = { lat: 36.7156191, lng: 5.0710866 };
const DEST = { lat: 36.7525297, lng: 5.085492 };
const tripUrl =
  `https://mobility-app.yassir.com/fr?/?pickup=${PICKUP.lat},${PICKUP.lng}` +
  `&destination=${DEST.lat},${DEST.lng}`;

const t = await findYassirPage();
const cdp = await CDP.attach(t.webSocketDebuggerUrl);
await cdp.send("Network.enable");
await cdp.send("Page.enable");

const reqUrl = new Map();
const reqMethod = new Map();
const reqPost = new Map();
const finished = [];

cdp.on(async (method, params) => {
  if (method === "Network.requestWillBeSent") {
    reqUrl.set(params.requestId, params.request.url);
    reqMethod.set(params.requestId, params.request.method);
    if (params.request.postData)
      reqPost.set(params.requestId, params.request.postData);
  }
  if (method === "Network.responseReceived") {
    const u = params.response.url;
    if (
      /yassir\.(io|com)|amazonaws|api|price|estimate|fare|quote|eta|product|vehicle|route/i.test(
        u
      )
    ) {
      finished.push({
        requestId: params.requestId,
        url: u,
        mime: params.response.mimeType,
        status: params.response.status,
      });
    }
  }
});

console.log("navigate:", tripUrl);
await cdp.send("Page.navigate", { url: tripUrl });
await new Promise((r) => setTimeout(r, 15000));

console.log("=== candidate API responses:", finished.length);
for (const f of finished) {
  let body = "";
  try {
    const b = await cdp.send("Network.getResponseBody", {
      requestId: f.requestId,
    });
    body = b.body || "";
  } catch {}
  if (
    /price|fare|amount|cost|estimate|eta|distance|duration|currency|dzd|vehicle|product/i.test(
      body + f.url
    )
  ) {
    console.log("\n---", f.status, reqMethod.get(f.requestId), f.url);
    const post = reqPost.get(f.requestId);
    if (post) console.log("POST:", post.slice(0, 300));
    console.log(body.slice(0, 900));
  }
}
cdp.close();
process.exit(0);
