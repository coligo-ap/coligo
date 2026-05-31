// Test d'impression BITMAP via CDP : rend tailles + polices variées + QR sur
// un canvas 384px (largeur tête 50/58mm Sunmi), binarise, et envoie a
// SunmiPrinter.printBitmap. SEULE voie pour des polices/tailles differentes sur
// ce firmware (setFontSize/ESC! ignores). Le QR est genere sur l'hote (zxing).
//   node scripts/_cdp-bitmap-test.mjs <wsUrl>
const wsUrl = process.argv[2];
if (!wsUrl) {
  console.error("usage: node _cdp-bitmap-test.mjs <wsUrl>");
  process.exit(1);
}

// --- 1. Matrice QR (hote, via @zxing/library deja en dependance) -----------
const _zx = await import("@zxing/library");
const { MultiFormatWriter, BarcodeFormat, EncodeHintType } = _zx.default ?? _zx;
const hints = new Map();
hints.set(EncodeHintType.MARGIN, 2);
const bm = new MultiFormatWriter().encode(
  "COLIGO-A042",
  BarcodeFormat.QR_CODE,
  0,
  0,
  hints
);
const qw = bm.getWidth();
const qh = bm.getHeight();
const matrix = [];
for (let y = 0; y < qh; y++) {
  const row = [];
  for (let x = 0; x < qw; x++) row.push(bm.get(x, y) ? 1 : 0);
  matrix.push(row);
}
const matrixJson = JSON.stringify(matrix);

// --- 2. Expression evaluee DANS la WebView (Chromium) ----------------------
// Pas de commentaire avec backslash dans ce template (un \n y deviendrait un
// vrai saut de ligne et casserait le JS injecte).
const EXPR = `(async () => {
  const p = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.SunmiPrinter;
  if (!p) return { error: "plugin SunmiPrinter introuvable" };
  const W = 384;
  const matrix = ${matrixJson};
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = 1200;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, 1200);
  ctx.fillStyle = "#000";
  let y = 4;
  const draw = (txt, font, x, baseTop) => { ctx.font = font; ctx.textBaseline = "top"; ctx.fillText(txt, x, baseTop); };

  // Ligne 1 PETITE puis Ligne 2 NORMALE collees (espace vertical minimal).
  draw("ligne 1 petite police", "15px sans-serif", 6, y); y += 16;
  draw("ligne 2 taille normale", "26px sans-serif", 6, y); y += 30;
  // Ligne 3 GRANDE.
  draw("LIGNE 3 GRANDE", "bold 46px sans-serif", 6, y); y += 56;

  // QR centre.
  const mods = matrix.length;
  const ms = Math.max(2, Math.floor(150 / mods));
  const qpx = ms * mods;
  const qx = Math.floor((W - qpx) / 2);
  for (let r = 0; r < mods; r++) for (let c = 0; c < mods; c++) {
    if (matrix[r][c]) ctx.fillRect(qx + c * ms, y + r * ms, ms, ms);
  }
  y += qpx + 12;

  // Ligne 2 mots, polices differentes.
  ctx.textBaseline = "alphabetic";
  let bx = 6; const b1 = y + 28;
  ctx.font = "28px serif"; ctx.fillText("Bonjour", bx, b1); bx += ctx.measureText("Bonjour ").width;
  ctx.font = "28px monospace"; ctx.fillText("Monde", bx, b1);
  y += 38;

  // "personne Algerienne traditionnal" : chaque mot une police tres differente.
  let mx = 6; const b2 = y + 30;
  ctx.font = "italic 30px serif"; ctx.fillText("personne", mx, b2); mx += ctx.measureText("personne ").width;
  ctx.font = "bold 24px monospace"; ctx.fillText("Algerienne", mx, b2); mx += ctx.measureText("Algerienne ").width;
  ctx.font = "30px cursive"; ctx.fillText("traditionnal", mx, b2);
  y += 42;

  // Recadre a la hauteur reelle + binarise (N&B strict pour le thermique).
  const H = Math.min(1200, y + 6);
  const out = document.createElement("canvas");
  out.width = W; out.height = H;
  const octx = out.getContext("2d");
  octx.drawImage(cv, 0, 0, W, H, 0, 0, W, H);
  const img = octx.getImageData(0, 0, W, H);
  const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
    const v = g >= 160 ? 255 : 0;
    d[i] = d[i+1] = d[i+2] = v; d[i+3] = 255;
  }
  octx.putImageData(img, 0, 0);
  const b64 = out.toDataURL("image/png").replace(/^data:image\\/png;base64,/, "");
  try {
    const res = await p.printBitmap({ bitmap: b64, copies: 1, buffer: true, cut: true, feedLines: 2 });
    return { ok: true, size: W + "x" + H, qrModules: mods, printResult: res };
  } catch (e) {
    return { error: String(e && e.message || e) };
  }
})()`;

// --- 3. Connexion CDP et evaluation ----------------------------------------
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
