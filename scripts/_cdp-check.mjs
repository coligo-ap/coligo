// Navigue la WebView vers une route et renvoie un extrait du texte rendu +
// d'eventuelles erreurs console. Diagnostic de rendu (refonte UI).
//   node scripts/_cdp-check.mjs <path>
import http from "node:http";
const path = process.argv[2] || "/dashboard";
const getJson = () =>
  new Promise((res, rej) => {
    http
      .get("http://localhost:9222/json", (r) => {
        let d = "";
        r.on("data", (c) => (d += c));
        r.on("end", () => res(JSON.parse(d)));
      })
      .on("error", rej);
  });
const page = (await getJson()).find((p) => p.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const handlers = [];
const send = (m, p) =>
  new Promise((r) => {
    const i = ++id;
    pending.set(i, r);
    ws.send(JSON.stringify({ id: i, method: m, params: p || {} }));
  });
const errors = [];
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result);
    pending.delete(m.id);
  } else if (
    m.method === "Runtime.consoleAPICalled" &&
    m.params.type === "error"
  ) {
    errors.push(
      m.params.args.map((a) => a.value || a.description || "").join(" ")
    );
  } else if (m.method === "Runtime.exceptionThrown") {
    errors.push(
      "EXCEPTION: " +
        (m.params.exceptionDetails?.exception?.description ||
          m.params.exceptionDetails?.text)
    );
  }
  handlers.forEach((h) => h(m));
});
const waitLoad = (t = 15000) =>
  new Promise((res) => {
    const to = setTimeout(res, t);
    handlers.push((m) => {
      if (m.method === "Page.loadEventFired") {
        clearTimeout(to);
        res();
      }
    });
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
ws.addEventListener("open", async () => {
  await send("Page.enable");
  await send("Runtime.enable");
  await send("Page.navigate", {
    url: "https://coligo-liart.vercel.app" + path,
  });
  await waitLoad();
  await sleep(5000);
  const r = await send("Runtime.evaluate", {
    expression: `({ url: location.pathname, text: document.body.innerText.replace(/\\s+/g,' ').slice(0, 600) })`,
    returnByValue: true,
  });
  console.log("URL:", r.result.value.url);
  console.log("TEXTE:", r.result.value.text);
  console.log("ERREURS:", errors.length ? errors.slice(0, 5) : "aucune");
  ws.close();
  process.exit(0);
});
ws.addEventListener("error", (e) => {
  console.error("WS:", e.message || e);
  process.exit(1);
});
setTimeout(() => {
  console.error("timeout");
  process.exit(1);
}, 40000);
