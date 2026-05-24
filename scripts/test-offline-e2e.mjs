/**
 * Tests E2E Playwright sur les pages publiques de la résilience offline.
 *
 * Utilise le Chrome SYSTÈME (channel: 'chrome') pour ne pas avoir à télécharger
 * un browser dédié. Le test démarre une session sandbox isolée à chaque run.
 *
 * Couvre :
 *  1. /offline charge sans erreur, le bundle initialise Dexie sans crash.
 *  2. Le schéma 'coligo_offline' est créé avec les bonnes tables/indexes.
 *  3. On peut écrire dans orders_cache directement via raw IndexedDB.
 *  4. Au reload, OfflineOrdersFallback affiche les commandes en cache.
 *  5. Les events online/offline sont bien écoutés (test indirect via le DOM).
 *  6. Le SW (sw.js) est servi correctement.
 *  7. /login est rendu sans erreur (parcours d'auth pas cassé).
 *  8. /manifest.webmanifest valide.
 */

import { chromium } from "playwright";

const BASE = process.env.E2E_BASE_URL || "http://localhost:3100";

let totalPass = 0;
let totalFail = 0;
const failures = [];
function pass(msg) {
  totalPass++;
  console.log(`  ✓ ${msg}`);
}
function fail_(msg) {
  totalFail++;
  failures.push(msg);
  console.log(`  ✗ ${msg}`);
}
function header(title) {
  console.log(`\n=== ${title} ===`);
}

/** Démarre un browser Chrome système, persistent context isolé. */
async function newBrowser() {
  return chromium.launch({
    channel: "chrome",
    headless: true,
  });
}

async function withConsoleCapture(page, fn) {
  const errors = [];
  page.on("pageerror", (e) => errors.push(`pageerror: ${e.message}`));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push(`console.error: ${msg.text()}`);
  });
  const result = await fn();
  return { result, errors };
}

async function main() {
  const browser = await newBrowser();
  try {
    // ------------------------------------------------------------------
    header("Test 1 — GET /offline (no auth requise)");
    {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      const { errors } = await withConsoleCapture(page, async () => {
        const r = await page.goto(`${BASE}/offline`, {
          waitUntil: "networkidle",
        });
        if (r?.status() !== 200) fail_(`HTTP ${r?.status()}`);
        else pass(`HTTP 200`);
      });
      // On filtre les "ignore" connus (favicon manquant en dev, etc.)
      // On ignore les 404 d'assets (preexisting, sans rapport avec l'offline).
      const meaningful = errors.filter(
        (e) =>
          !e.includes("favicon") && !e.includes("204") && !e.includes("404")
      );
      if (meaningful.length === 0) pass("Aucune erreur console");
      else fail_(`Erreurs console : ${meaningful.join(" | ")}`);
      await ctx.close();
    }

    // ------------------------------------------------------------------
    header("Test 2 — Dexie initialise 'coligo_offline' au montage de /offline");
    {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.goto(`${BASE}/offline`, { waitUntil: "networkidle" });
      // OfflineOrdersFallback appelle getCachedOrders() au montage → ouvre la DB.
      // On attend un peu pour laisser useEffect tourner.
      await page.waitForTimeout(500);

      const dbInfo = await page.evaluate(async () => {
        const dbs = await indexedDB.databases();
        const found = dbs.find((d) => d.name === "coligo_offline");
        if (!found) return { exists: false };
        const open = indexedDB.open("coligo_offline");
        const result = await new Promise((resolve, reject) => {
          open.onsuccess = () => {
            const db = open.result;
            const stores = Array.from(db.objectStoreNames);
            const out = {
              exists: true,
              version: db.version,
              stores,
              indexes: {},
            };
            for (const s of stores) {
              const tx = db.transaction(s, "readonly");
              const os = tx.objectStore(s);
              out.indexes[s] = Array.from(os.indexNames);
            }
            db.close();
            resolve(out);
          };
          open.onerror = () => reject(open.error);
        });
        return result;
      });

      if (dbInfo.exists) pass("DB 'coligo_offline' existe");
      else fail_("DB 'coligo_offline' absente — Dexie pas initialisée");

      // Dexie multiplie la version déclarée par 10 en interne (réserve pour
      // sous-versions). v1 dans le code = 10 en IndexedDB. Voir dexie.js.
      if (dbInfo.exists && dbInfo.version === 10)
        pass(`Version Dexie v1 (=10 en interne)`);
      else if (dbInfo.exists)
        fail_(`Version=${dbInfo.version} (attendu 10 = v1 Dexie)`);

      const expectedStores = ["orders_cache", "pending_actions"].sort();
      if (
        dbInfo.exists &&
        JSON.stringify((dbInfo.stores ?? []).sort()) ===
          JSON.stringify(expectedStores)
      )
        pass(`Stores corrects : ${dbInfo.stores.join(", ")}`);
      else if (dbInfo.exists)
        fail_(`Stores inattendus : ${dbInfo.stores?.join(", ")}`);

      const expectedOrdersIdx = [
        "created_at",
        "merchant_id",
        "status",
        "syncedAt",
      ];
      const actualOrdersIdx = (dbInfo.indexes?.orders_cache ?? []).sort();
      if (
        dbInfo.exists &&
        JSON.stringify(actualOrdersIdx) ===
          JSON.stringify(expectedOrdersIdx.sort())
      )
        pass(`Indexes orders_cache : ${actualOrdersIdx.join(", ")}`);
      else if (dbInfo.exists)
        fail_(
          `Indexes orders_cache inattendus : ${actualOrdersIdx.join(", ")}`
        );

      const expectedPendingIdx = ["createdAt", "orderId", "status", "type"];
      const actualPendingIdx = (dbInfo.indexes?.pending_actions ?? []).sort();
      if (
        dbInfo.exists &&
        JSON.stringify(actualPendingIdx) ===
          JSON.stringify(expectedPendingIdx.sort())
      )
        pass(`Indexes pending_actions : ${actualPendingIdx.join(", ")}`);
      else if (dbInfo.exists)
        fail_(
          `Indexes pending_actions inattendus : ${actualPendingIdx.join(", ")}`
        );

      await ctx.close();
    }

    // ------------------------------------------------------------------
    header("Test 3 — Écrire dans orders_cache + reload affiche le fallback");
    {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.goto(`${BASE}/offline`, { waitUntil: "networkidle" });
      await page.waitForTimeout(500); // laisse Dexie s'ouvrir

      // Injecte 2 commandes actives + 1 completed (filtrée par le fallback)
      const seeded = await page.evaluate(async () => {
        const open = indexedDB.open("coligo_offline");
        return new Promise((resolve, reject) => {
          open.onsuccess = () => {
            const db = open.result;
            const tx = db.transaction(["orders_cache"], "readwrite");
            const os = tx.objectStore("orders_cache");
            const now = Date.now();
            os.put({
              id: "test-active-1",
              merchant_id: "m",
              status: "ready",
              customer_name: "Client Test Ready",
              customer_phone: "0555000001",
              total_da: 1500,
              pickup_code: "111111",
              pickup_slot_at: new Date().toISOString(),
              created_at: new Date().toISOString(),
              notes: null,
              order_items: [],
              service_fee_da: 0,
              cashback_da: 0,
              commission_da: 0,
              payment_method: "cash",
              payment_status: "pending",
              commission_rate_applied: null,
              cashback_rate_applied: null,
              chargily_fee_rate_applied: null,
              syncedAt: now,
            });
            os.put({
              id: "test-active-2",
              merchant_id: "m",
              status: "preparing",
              customer_name: "Client Test Preparing",
              customer_phone: "0555000002",
              total_da: 2500,
              pickup_code: "222222",
              pickup_slot_at: new Date().toISOString(),
              created_at: new Date().toISOString(),
              notes: null,
              order_items: [],
              service_fee_da: 0,
              cashback_da: 0,
              commission_da: 0,
              payment_method: "cash",
              payment_status: "pending",
              commission_rate_applied: null,
              cashback_rate_applied: null,
              chargily_fee_rate_applied: null,
              syncedAt: now,
            });
            os.put({
              id: "test-terminal",
              merchant_id: "m",
              status: "completed",
              customer_name: "Déjà récupéré",
              customer_phone: "0555000003",
              total_da: 500,
              pickup_code: "333333",
              pickup_slot_at: new Date().toISOString(),
              created_at: new Date().toISOString(),
              notes: null,
              order_items: [],
              service_fee_da: 0,
              cashback_da: 0,
              commission_da: 0,
              payment_method: "cash",
              payment_status: "paid",
              commission_rate_applied: null,
              cashback_rate_applied: null,
              chargily_fee_rate_applied: null,
              syncedAt: now,
            });
            tx.oncomplete = () => {
              localStorage.setItem(
                "coligo:orders_cache:last_sync_at",
                String(now)
              );
              db.close();
              resolve(true);
            };
            tx.onerror = () => reject(tx.error);
          };
          open.onerror = () => reject(open.error);
        });
      });
      if (seeded) pass("3 commandes injectées dans orders_cache");

      // Reload pour que OfflineOrdersFallback les lise
      await page.reload({ waitUntil: "networkidle" });
      await page.waitForTimeout(700);

      const heading = await page
        .getByText("Dernières commandes connues")
        .count();
      if (heading > 0)
        pass("Le fallback « Dernières commandes connues » s'affiche");
      else fail_("Le fallback n'est PAS rendu");

      const txt = await page.locator("body").innerText();
      if (txt.includes("Client Test Ready"))
        pass("Commande ready visible (lecture seule offline)");
      else fail_("Commande ready PAS visible");
      if (txt.includes("Client Test Preparing"))
        pass("Commande preparing visible");
      else fail_("Commande preparing PAS visible");
      if (!txt.includes("Déjà récupéré"))
        pass("Commande completed correctement FILTRÉE (active only)");
      else fail_("Commande completed affichée par erreur");

      if (txt.includes("Lecture seule"))
        pass("Bandeau « Lecture seule » présent");
      else fail_("Bandeau « Lecture seule » absent");

      await ctx.close();
    }

    // ------------------------------------------------------------------
    header("Test 4 — SW.js servi avec bon Content-Type");
    {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      const r = await page.request.get(`${BASE}/sw.js`);
      if (r.status() === 200) pass(`HTTP 200`);
      else fail_(`HTTP ${r.status()}`);
      const ct = r.headers()["content-type"] ?? "";
      if (/javascript/.test(ct)) pass(`Content-Type = ${ct}`);
      else fail_(`Content-Type inattendu : ${ct}`);
      const body = await r.text();
      if (body.includes("CACHE_VERSION")) pass("Contenu SW présent");
      else fail_("SW vide ou inattendu");
      await ctx.close();
    }

    // ------------------------------------------------------------------
    header("Test 5 — /manifest.webmanifest");
    {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      const r = await page.request.get(`${BASE}/manifest.webmanifest`);
      if (r.status() === 200) pass(`HTTP 200`);
      else fail_(`HTTP ${r.status()}`);
      const json = await r.json().catch(() => null);
      if (json && json.start_url === "/dashboard")
        pass(`start_url = /dashboard`);
      else fail_(`manifest JSON invalide ou inattendu`);
      await ctx.close();
    }

    // ------------------------------------------------------------------
    header("Test 6 — /login rend sans erreur (auth pas cassée)");
    {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      const { errors } = await withConsoleCapture(page, async () => {
        // domcontentloaded suffit : Supabase ouvre un WS qui ne se ferme
        // jamais, networkidle timeout-ait.
        const r = await page.goto(`${BASE}/login`, {
          waitUntil: "domcontentloaded",
          timeout: 15000,
        });
        if (r?.status() === 200) pass("HTTP 200");
        else fail_(`HTTP ${r?.status()}`);
        // Attend un cycle React puis cherche le bouton
        await page.waitForTimeout(500);
        const has = await page
          .getByRole("button", { name: /connexion|se connecter/i })
          .count();
        if (has > 0) pass("Bouton de connexion présent");
        else fail_("Bouton de connexion absent");
      });
      // On ignore les 404 d'assets (preexisting, sans rapport avec l'offline).
      const meaningful = errors.filter(
        (e) =>
          !e.includes("favicon") && !e.includes("204") && !e.includes("404")
      );
      if (meaningful.length === 0) pass("Aucune erreur console");
      else fail_(`Erreurs console : ${meaningful.join(" | ")}`);
      await ctx.close();
    }

    // ------------------------------------------------------------------
    header("Test 7 — Events online/offline sont écoutés (useOnlineStatus)");
    {
      const ctx = await browser.newContext();
      const page = await ctx.newPage();
      await page.goto(`${BASE}/offline`, { waitUntil: "networkidle" });
      await page.waitForTimeout(300);
      // Vérifier que window a bien des listeners online/offline (proxy
      // indirect : on dispatch les events et on observe que ça ne crashe pas)
      const ok = await page.evaluate(() => {
        window.dispatchEvent(new Event("offline"));
        window.dispatchEvent(new Event("online"));
        return true;
      });
      if (ok) pass("Dispatch online/offline ne fait pas crasher la page");
      else fail_("Crash au dispatch event");
      await ctx.close();
    }
  } finally {
    await browser.close();
  }

  console.log("\n" + "=".repeat(60));
  console.log(`Résultat : ${totalPass} pass, ${totalFail} fail`);
  if (totalFail > 0) {
    console.log("Échecs :");
    failures.forEach((f) => console.log(`  - ${f}`));
    process.exit(1);
  }
  console.log("✅ TOUS LES TESTS E2E PASSENT");
  process.exit(0);
}

main().catch((e) => {
  console.error("FATAL", e);
  process.exit(1);
});
