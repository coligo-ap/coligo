// Pilote la WebView Capacitor via Chrome DevTools Protocol pour déclencher
// un test d'impression Sunmi SANS toucher l'écran. Usage interne diagnostic.
//   node scripts/_cdp-print-test.mjs <wsUrl>
const wsUrl = process.argv[2];
if (!wsUrl) {
  console.error("usage: node _cdp-print-test.mjs <webSocketDebuggerUrl>");
  process.exit(1);
}

const EXPR = `(async () => {
  const p = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.SunmiPrinter;
  if (!p) return { error: "plugin SunmiPrinter introuvable" };
  let avail = null;
  try { avail = await p.isAvailable(); } catch (e) { avail = { threw: String(e && e.message || e) }; }
  // TEST COMPARATIF doc officielle Sunmi : ZERO octet brut, pas de ESC 3.
  // Bloc A = printText (saut de ligne auto) | Bloc B = printColumnsText.
  // But : voir laquelle imprime, si interligne normal (compact), alignement OK.
  const commands = [
    { type: "paper", columns: 32 },
    { type: "line", text: "=== A printText ===", align: "center" },
    { type: "line", text: "A1 gauche", align: "left" },
    { type: "line", text: "A2 centre", align: "center" },
    { type: "line", text: "A3 droite", align: "right" },
    { type: "col", text: "=== B colText ===", align: "center" },
    { type: "col", text: "B1 gauche", align: "left" },
    { type: "col", text: "B2 centre", align: "center" },
    { type: "col", text: "B3 droite", align: "right" }
  ];
  try {
    const res = await p.print({ commands, copies: 1 });
    return { ok: true, isAvailable: avail, commandsSent: commands.length, printResult: res };
  } catch (e) {
    return { error: String(e && e.message || e), isAvailable: avail };
  }
})()`;

const ws = new WebSocket(wsUrl);
let id = 0;
const pending = new Map();
function send(method, params) {
  return new Promise((resolve) => {
    const msgId = ++id;
    pending.set(msgId, resolve);
    ws.send(JSON.stringify({ id: msgId, method, params: params || {} }));
  });
}

ws.addEventListener("open", async () => {
  await send("Runtime.enable");
  const r = await send("Runtime.evaluate", {
    expression: EXPR,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.exceptionDetails) {
    console.log("EXCEPTION:", JSON.stringify(r.exceptionDetails, null, 2));
  } else {
    console.log(
      "RESULT:",
      JSON.stringify(r.result?.value ?? r.result, null, 2)
    );
  }
  ws.close();
  process.exit(0);
});

ws.addEventListener("message", (ev) => {
  const msg = JSON.parse(ev.data);
  if (msg.id && pending.has(msg.id)) {
    pending.get(msg.id)(msg.result);
    pending.delete(msg.id);
  }
});

ws.addEventListener("error", (e) => {
  console.error("WS error:", e.message || e);
  process.exit(1);
});

setTimeout(() => {
  console.error("timeout 30s");
  process.exit(1);
}, 30000);
