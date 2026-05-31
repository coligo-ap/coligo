// Test du VRAI ticket de commande rendu en BITMAP (384px, 50/58mm Sunmi).
// Style Deliveroo : en-tete, bandeau inverse, #commande geant, articles,
// recap, total, QR, pied. But : valider le rendu avant de cabler en prod.
//   node scripts/_cdp-ticket-bitmap.mjs <wsUrl>
const wsUrl = process.argv[2];
if (!wsUrl) {
  console.error("usage: node _cdp-ticket-bitmap.mjs <wsUrl>");
  process.exit(1);
}

// --- QR (matrice generee sur l'hote via zxing) -----------------------------
const _zx = await import("@zxing/library");
const { MultiFormatWriter, BarcodeFormat, EncodeHintType } = _zx.default ?? _zx;
const hints = new Map();
hints.set(EncodeHintType.MARGIN, 1);
const bm = new MultiFormatWriter().encode(
  "A042",
  BarcodeFormat.QR_CODE,
  0,
  0,
  hints
);
const qn = bm.getWidth();
const matrix = [];
for (let y = 0; y < qn; y++) {
  const row = [];
  for (let x = 0; x < qn; x++) row.push(bm.get(x, y) ? 1 : 0);
  matrix.push(row);
}
const matrixJson = JSON.stringify(matrix);

const EXPR = `(async () => {
  const p = window.Capacitor && window.Capacitor.Plugins && window.Capacitor.Plugins.SunmiPrinter;
  if (!p) return { error: "plugin SunmiPrinter introuvable" };
  const W = 384, PAD = 14;
  const matrix = ${matrixJson};
  const cv = document.createElement("canvas");
  cv.width = W; cv.height = 2000;
  const ctx = cv.getContext("2d");
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, W, 2000);
  ctx.fillStyle = "#000";
  let y = 10;

  const SANS = "sans-serif";
  function textAt(txt, font, align, yTop) {
    ctx.font = font; ctx.textBaseline = "top";
    let x = PAD;
    if (align === "center") x = (W - ctx.measureText(txt).width) / 2;
    else if (align === "right") x = W - PAD - ctx.measureText(txt).width;
    ctx.fillText(txt, x, yTop);
  }
  function lineLR(l, r, font, yTop) {
    ctx.font = font; ctx.textBaseline = "top";
    ctx.fillText(l, PAD, yTop);
    ctx.fillText(r, W - PAD - ctx.measureText(r).width, yTop);
  }
  function wrapDraw(txt, font, yTop, lh) {
    ctx.font = font; ctx.textBaseline = "top";
    const words = txt.split(" "); let line = ""; let yy = yTop;
    for (const w of words) {
      const t = line ? line + " " + w : w;
      if (ctx.measureText(t).width > W - 2 * PAD && line) { ctx.fillText(line, PAD, yy); yy += lh; line = w; }
      else line = t;
    }
    if (line) { ctx.fillText(line, PAD, yy); yy += lh; }
    return yy;
  }
  function divider(yTop) {
    ctx.strokeStyle = "#000"; ctx.lineWidth = 1; ctx.beginPath();
    ctx.setLineDash([4, 3]); ctx.moveTo(PAD, yTop + 4); ctx.lineTo(W - PAD, yTop + 4);
    ctx.stroke(); ctx.setLineDash([]);
    return yTop + 12;
  }

  // En-tete
  textAt("COLIGO", "bold 30px " + SANS, "center", y); y += 34;
  textAt("Boulangerie Demo", "20px " + SANS, "center", y); y += 28;

  // Bandeau inverse (fond noir, texte blanc)
  const bh = 34;
  ctx.fillStyle = "#000"; ctx.fillRect(PAD, y, W - 2 * PAD, bh);
  ctx.fillStyle = "#fff";
  textAt("RETRAIT - CASH", "bold 22px " + SANS, "center", y + 6);
  ctx.fillStyle = "#000";
  y += bh + 12;

  // #commande GEANT
  textAt("#A042", "bold 60px " + SANS, "left", y); y += 64;
  textAt("Retrait pour : 13:35", "22px " + SANS, "left", y); y += 28;
  y = divider(y);

  // Articles
  const cats = [
    { t: "VIENNOISERIE (4)", items: ["2x Croissant beurre", "1x Pain au chocolat", "1x Chausson aux pommes"] },
    { t: "PAIN (3)", items: ["2x Baguette tradition", "1x Pain de campagne"] }
  ];
  for (const c of cats) {
    textAt(c.t, "bold 21px " + SANS, "left", y); y += 26;
    for (const it of c.items) { textAt(it, "bold 23px " + SANS, "left", y); y += 27; }
  }
  y = divider(y);

  // Recap
  lineLR("Nombre de produits", "7", "21px " + SANS, y); y += 26;
  lineLR("Sous-total", "1180 DA", "21px " + SANS, y); y += 26;
  lineLR("Reduction -10%", "-118 DA", "21px " + SANS, y); y += 28;
  lineLR("A ENCAISSER", "1062 DA", "bold 27px " + SANS, y); y += 32;
  textAt("paiement en especes au retrait", "17px " + SANS, "center", y); y += 24;
  y = divider(y);

  // Bloc infos
  y = wrapDraw("Heure commande : 13:14, 1 juin", "20px " + SANS, y, 25);
  y = wrapDraw("Client : Yacine B.", "20px " + SANS, y, 25);
  y = wrapDraw("Telephone : 0555 12 34 56", "20px " + SANS, y, 25);
  y = divider(y);

  // QR + pied
  const mods = matrix.length;
  const ms = Math.max(2, Math.floor(140 / mods));
  const qpx = ms * mods; const qx = Math.floor((W - qpx) / 2);
  for (let r = 0; r < mods; r++) for (let c = 0; c < mods; c++)
    if (matrix[r][c]) ctx.fillRect(qx + c * ms, y + r * ms, ms, ms);
  y += qpx + 8;
  textAt("Merci de votre confiance", "bold 19px " + SANS, "center", y); y += 26;

  // Recadre + binarise
  const H = Math.min(2000, y + 8);
  const out = document.createElement("canvas"); out.width = W; out.height = H;
  const octx = out.getContext("2d");
  octx.drawImage(cv, 0, 0, W, H, 0, 0, W, H);
  const img = octx.getImageData(0, 0, W, H); const d = img.data;
  for (let i = 0; i < d.length; i += 4) {
    const g = 0.299 * d[i] + 0.587 * d[i+1] + 0.114 * d[i+2];
    const v = g >= 160 ? 255 : 0; d[i] = d[i+1] = d[i+2] = v; d[i+3] = 255;
  }
  octx.putImageData(img, 0, 0);
  const b64 = out.toDataURL("image/png").replace(/^data:image\\/png;base64,/, "");
  try {
    const res = await p.printBitmap({ bitmap: b64, copies: 1, buffer: true, cut: true, feedLines: 2 });
    return { ok: true, size: W + "x" + H, mm: Math.round(H / 8) + "mm", printResult: res };
  } catch (e) { return { error: String(e && e.message || e) }; }
})()`;

const ws = new WebSocket(wsUrl);
let id = 0;
const pending = new Map();
const send = (method, params) =>
  new Promise((res) => {
    const i = ++id;
    pending.set(i, res);
    ws.send(JSON.stringify({ id: i, method, params: params || {} }));
  });
ws.addEventListener("open", async () => {
  await send("Runtime.enable");
  const r = await send("Runtime.evaluate", {
    expression: EXPR,
    awaitPromise: true,
    returnByValue: true,
  });
  if (r.exceptionDetails)
    console.log("EXCEPTION:", JSON.stringify(r.exceptionDetails, null, 2));
  else
    console.log(
      "RESULT:",
      JSON.stringify(r.result?.value ?? r.result, null, 2)
    );
  ws.close();
  process.exit(0);
});
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result);
    pending.delete(m.id);
  }
});
ws.addEventListener("error", (e) => {
  console.error("WS error:", e.message || e);
  process.exit(1);
});
setTimeout(() => {
  console.error("timeout");
  process.exit(1);
}, 30000);
