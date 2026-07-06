// Vérif VISUELLE des écrans chauffeur Drive (même JS Vercel que l'APK) :
// Chrome headless + CDP, viewport mobile 390×844, login démo Ahmed, captures
// dans playwright-shots/. Vérifie : accueil HORS LIGNE (bouton GO), passage
// EN LIGNE (« Se mettre hors ligne »), demandes, compte (photo de visage).
//   node scripts/_cdp-drive-screens.mjs
import { spawn } from "node:child_process";
import { writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import http from "node:http";

const BASE = "https://coligo.app";
const PORT = 9223;
const SHOTS = "playwright-shots";

const CHROME = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const profile = mkdtempSync(join(tmpdir(), "cdp-coligo-"));
const browser = spawn(
  CHROME,
  [
    "--headless=new",
    `--remote-debugging-port=${PORT}`,
    `--user-data-dir=${profile}`,
    "--no-first-run",
    "--lang=fr",
    "--window-size=420,950",
  ],
  { stdio: "ignore" }
);

const getJson = (path = "/json") =>
  new Promise((resolve, reject) => {
    http
      .get(`http://localhost:${PORT}${path}`, (res) => {
        let d = "";
        res.on("data", (c) => (d += c));
        res.on("end", () => resolve(JSON.parse(d)));
      })
      .on("error", reject);
  });
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

let pages;
for (let i = 0; i < 30; i++) {
  try {
    pages = await getJson();
    if (pages.some((p) => p.type === "page")) break;
  } catch {}
  await sleep(500);
}
const page = pages.find((p) => p.type === "page");
const ws = new WebSocket(page.webSocketDebuggerUrl);
let id = 0;
const pending = new Map();
const handlers = [];
const send = (method, params) =>
  new Promise((res) => {
    const i = ++id;
    pending.set(i, res);
    // Garde-fou : une commande CDP perdue ne doit pas bloquer le run.
    setTimeout(() => {
      if (pending.has(i)) {
        pending.delete(i);
        res(null);
      }
    }, 30000);
    ws.send(JSON.stringify({ id: i, method, params: params || {} }));
  });
ws.addEventListener("message", (ev) => {
  const m = JSON.parse(ev.data);
  if (m.id && pending.has(m.id)) {
    pending.get(m.id)(m.result ?? m.error);
    pending.delete(m.id);
  } else if (m.method) handlers.forEach((h) => h(m));
});
const waitLoad = (timeout = 20000) =>
  new Promise((resolve) => {
    const t = setTimeout(resolve, timeout);
    handlers.push((m) => {
      if (m.method === "Page.loadEventFired") {
        clearTimeout(t);
        resolve();
      }
    });
  });

const eval_ = async (expression) =>
  (await send("Runtime.evaluate", { expression, returnByValue: true }))?.result
    ?.value;
const shot = async (name) => {
  const r = await send("Page.captureScreenshot", { format: "png" });
  writeFileSync(join(SHOTS, name), Buffer.from(r.data, "base64"));
  console.log(`  📸 ${name}`);
};
const clickByText = (re) =>
  eval_(`(() => {
    const els = Array.from(document.querySelectorAll('button, a, [role="button"]'));
    const el = els.find(x => ${re}.test((x.textContent||'').trim()));
    if (!el) return false;
    el.scrollIntoView({ block: 'center' }); el.click(); return true;
  })()`);
const bodyHas = async (re) =>
  eval_(`${re}.test(document.body ? document.body.innerText : '')`);

let pass = 0,
  fail = 0;
const ok = (label, got, want = true) => {
  const p = got === want;
  console.log(`${p ? "✅" : "❌"} ${label}`);
  p ? pass++ : fail++;
};

ws.addEventListener("open", async () => {
  try {
    await send("Page.enable");
    await send("Runtime.enable");
    await send("Emulation.setDeviceMetricsOverride", {
      width: 390,
      height: 844,
      deviceScaleFactor: 2,
      mobile: true,
    });
    // Géoloc simulée (Alger) — la permission peut être refusée en headless,
    // les écrans doivent s'afficher quand même (carte sans curseur).
    await send("Emulation.setGeolocationOverride", {
      latitude: 36.7538,
      longitude: 3.0588,
      accuracy: 10,
    });

    // 1. Login chauffeur démo
    console.log("→ /chauffeur/login");
    await send("Page.navigate", { url: `${BASE}/chauffeur/login` });
    await waitLoad();
    await sleep(5000);
    await eval_(`(() => {
      const set = (sel, v) => {
        const el = document.querySelector(sel);
        const d = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value');
        d.set.call(el, v);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      };
      set('input[name="phone"]', '0550100001');
      set('input[name="password"]', '0550100001');
    })()`);
    await clickByText("/se connecter/i");
    await sleep(8000);
    const url1 = await eval_("location.pathname");
    ok(`login démo → ${url1}`, url1 === "/chauffeur");

    // 2. Accueil HORS LIGNE par défaut : pill grise + bouton GO
    ok("pill « Hors ligne » affichée", await bodyHas("/Hors ligne/"));
    ok(
      "bouton « Passer en ligne · GO » affiché",
      await bodyHas("/Passer en ligne/")
    );
    ok(
      "message « Vous êtes hors ligne »",
      await bodyHas("/Vous êtes hors ligne/")
    );
    await shot("drive-chauffeur-home-offline.png");

    // 3. Clic GO → EN LIGNE
    await clickByText("/Passer en ligne/i");
    await sleep(4000);
    ok("pill « En ligne · Drive »", await bodyHas("/En ligne · Drive/"));
    ok(
      "bouton « Se mettre hors ligne » présent",
      await bodyHas("/Se mettre hors ligne/")
    );
    ok(
      "bouton « Voir les demandes » présent",
      await bodyHas("/Voir les demandes/")
    );
    await shot("drive-chauffeur-home-online.png");

    // 4. Demandes proches
    console.log("→ /chauffeur/demandes");
    await send("Page.navigate", { url: `${BASE}/chauffeur/demandes` });
    await waitLoad();
    await sleep(6000);
    ok("écran demandes rendu", await bodyHas("/[Dd]emande/"));
    await shot("drive-chauffeur-demandes.png");

    // 5. Compte : photo de visage (img) à la place de l'initiale
    console.log("→ /chauffeur/compte");
    await send("Page.navigate", { url: `${BASE}/chauffeur/compte` });
    await waitLoad();
    await sleep(6000);
    const avatar = await eval_(`(() => {
      const img = document.querySelector('img[alt="Ahmed"]');
      return img ? { src: img.currentSrc.slice(0, 60), loaded: img.naturalWidth > 0 } : null;
    })()`);
    ok(
      `photo de visage chargée sur le profil (${avatar?.src ?? "absente"}…)`,
      avatar?.loaded === true
    );
    await shot("drive-chauffeur-compte.png");

    // 6. Retour hors ligne (état neutre) puis fin
    await send("Page.navigate", { url: `${BASE}/chauffeur` });
    await waitLoad();
    await sleep(6000);
    await clickByText("/Se mettre hors ligne/i");
    await sleep(2500);
    ok("retour hors ligne OK", await bodyHas("/Passer en ligne/"));

    console.log(
      `\n${fail === 0 ? "🎉" : "💥"} ÉCRANS DRIVE — pass=${pass} fail=${fail}`
    );
  } finally {
    browser.kill();
    process.exit(fail === 0 ? 0 : 1);
  }
});
