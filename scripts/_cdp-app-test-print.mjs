// Valide le VRAI chemin de production : navigue la WebView vers /settings
// (charge le JS Vercel deploye) et clique le bouton « Test impression », qui
// appelle printOrderTicket -> render-ticket-canvas -> printBitmap.
//   node scripts/_cdp-app-test-print.mjs
import http from "node:http";

function getJson() {
  return new Promise((resolve, reject) => {
    http
      .get("http://localhost:9222/json", (res) => {
        let data = "";
        res.on("data", (c) => (data += c));
        res.on("end", () => resolve(JSON.parse(data)));
      })
      .on("error", reject);
  });
}

const pages = await getJson();
const page = pages.find((p) => p.type === "page");
if (!page) {
  console.error("aucune page");
  process.exit(1);
}
console.log("page initiale:", page.url);

const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const handlers = [];
const send = (method, params) =>
  new Promise((res) => {
    const i = ++id;
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params: params || {} }));
  });
const onEvent = (fn) => handlers.push(fn);

ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result);
    pending.delete(m.id);
  } else if (m.method) handlers.forEach((h) => h(m));
});

function waitLoad(timeout = 15000) {
  return new Promise((resolve) => {
    const t = setTimeout(resolve, timeout);
    onEvent((m) => {
      if (m.method === "Page.loadEventFired") {
        clearTimeout(t);
        resolve();
      }
    });
  });
}
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

ws.addEventListener("open", async () => {
  await send("Page.enable");
  await send("Runtime.enable");
  console.log("navigation -> /settings ...");
  await send("Page.navigate", {
    url: "https://coligo.app/settings",
  });
  await waitLoad();
  await sleep(5000); // hydratation React + chargement chunks

  const clickByText = async (re, label) => {
    const r = await send("Runtime.evaluate", {
      expression: `(() => {
        const els = Array.from(document.querySelectorAll('button, a, [role="button"]'));
        const el = els.find(x => ${re}.test((x.textContent||'')));
        if (!el) return { found: false, items: els.map(x=>(x.textContent||'').trim()).filter(Boolean).slice(0,25) };
        el.scrollIntoView({ block: 'center' });
        el.click();
        return { found: true };
      })()`,
      returnByValue: true,
    });
    const v = r.result?.value ?? r.result;
    console.log(label + ":", JSON.stringify(v));
    return v;
  };

  // 1. Ouvre la section « Impression du ticket ».
  await clickByText("/impression du ticket/i", "section impression");
  await sleep(2500);
  // 2. Clique « Test impression ».
  await clickByText("/test impression/i", "clic test");
  await sleep(6000); // laisse l'impression partir
  ws.close();
  process.exit(0);
});
ws.addEventListener("error", (e) => {
  console.error("WS error:", e.message || e);
  process.exit(1);
});
setTimeout(() => {
  console.error("timeout global");
  process.exit(1);
}, 45000);
