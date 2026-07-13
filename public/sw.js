/* Coligo — Service Worker (hand-rolled, sans dépendance).
 *
 * Stratégies :
 *  - navigations HTML            → network-first (réponse fraîche prioritaire),
 *                                  repli : dernière copie en cache, puis `/offline`
 *  - assets statiques Next/icônes/manifests → cache-first
 *  - API/Supabase/RSC            → JAMAIS cachés (données fraîches)
 *
 * skipWaiting + clients.claim : un nouveau SW prend la main immédiatement
 * (pas d'onglet servi par un vieux worker), et l'activation purge tous les
 * caches des versions précédentes. Bump CACHE_VERSION pour invalider tout le
 * cache à un nouveau déploiement.
 */
// v17 : préparation TWA — le document HTML n'est plus JAMAIS servi depuis un
// cache périmé en priorité (network-first strict) ; le cache ne sert de repli
// qu'en cas d'échec réseau. Correction : les manifests réels sont
// `manifest-*.webmanifest` (l'ancien `/manifest.webmanifest` n'existe pas) et
// les icônes vivent sous `/icons/`.
// v19 : ANTI-GEL AU RÉVEIL — le fetch de navigation est BORNÉ (AbortController).
// Bug vécu : au retour d'une longue absence, le socket keep-alive à
// moitié mort rendait ce fetch FANTÔME (ni succès ni échec) → même la
// navigation DURE (location.assign du watchdog) restait suspendue DANS le
// service worker : écran gelé « pour toujours ».
// v20 : COURSE réseau ⟷ cache. Page déjà en cache : le réseau a `NAV_RACE_MS`
// pour répondre, sinon la copie en cache s'affiche TOUT DE SUITE pendant que
// le réseau continue en arrière-plan et rafraîchit le cache
// (stale-while-revalidate). Page jamais visitée : on attend le réseau jusqu'au
// plafond dur `NAV_FETCH_TIMEOUT_MS`, puis /offline (auto-rechargée au retour
// du réseau). Le réseau reste prioritaire dès qu'il répond dans les temps.
const CACHE_VERSION = "coligo-v20";
/** Plafond DUR du fetch réseau d'une navigation (socket mort/figé). */
const NAV_FETCH_TIMEOUT_MS = 8000;
/** Budget accordé au réseau quand une copie en cache existe déjà. */
const NAV_RACE_MS = 3500;
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const PRECACHE_CACHE = `${CACHE_VERSION}-precache`;
const OFFLINE_URL = "/offline";
const PRECACHE_URLS = [
  OFFLINE_URL,
  "/manifest-client.webmanifest",
  "/manifest-livreur.webmanifest",
  "/manifest-drive.webmanifest",
  "/manifest-commercant.webmanifest",
  "/icons/client-192.png",
  "/icons/client-512.png",
  "/icons/client-maskable-512.png",
  "/apple-touch-icon.png",
  "/favicon-32.png",
];

self.addEventListener("install", (event) => {
  event.waitUntil(
    (async () => {
      const cache = await caches.open(PRECACHE_CACHE);
      // Tolérant : on essaie d'ajouter chaque URL ; un échec (ex. /offline pas
      // encore généré pendant un déploiement partiel) ne casse pas l'install.
      await Promise.all(
        PRECACHE_URLS.map((url) =>
          cache.add(url).catch(() => {
            /* ignoré */
          })
        )
      );
      await self.skipWaiting();
    })()
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      await Promise.all(
        keys
          .filter((k) => !k.startsWith(CACHE_VERSION))
          .map((k) => caches.delete(k))
      );
      await self.clients.claim();
    })()
  );
});

function isStaticAsset(url) {
  return (
    url.pathname.startsWith("/_next/static/") ||
    url.pathname.startsWith("/icons/") ||
    url.pathname.startsWith("/icon-") ||
    url.pathname === "/favicon-32.png" ||
    url.pathname === "/apple-touch-icon.png" ||
    /^\/manifest-[a-z]+\.webmanifest$/.test(url.pathname)
  );
}

function isApiOrData(url) {
  return (
    url.pathname.startsWith("/api/") ||
    url.pathname.startsWith("/auth/") ||
    url.search.includes("_rsc=") ||
    url.search.includes("rsc=")
  );
}

self.addEventListener("fetch", (event) => {
  const req = event.request;
  if (req.method !== "GET") return;

  const url = new URL(req.url);

  // On ne touche qu'à notre origine.
  if (url.origin !== self.location.origin) return;

  // API / RSC / Supabase auth → jamais de cache, pas d'interception.
  if (isApiOrData(url)) return;

  // Navigations (documents HTML) → réseau prioritaire, mais BORNÉ : page déjà
  // en cache = course réseau (NAV_RACE_MS) puis copie servie tout de suite avec
  // revalidation en arrière-plan ; page inconnue = réseau jusqu'au plafond dur,
  // puis `/offline`.
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        // BORNÉ : jamais de fetch de navigation illimité (voir en-tête v19/v20).
        const runtime = await caches.open(RUNTIME_CACHE);
        const cachedPage = await runtime.match(req);
        const controller = new AbortController();
        const hardTimer = setTimeout(
          () => controller.abort(),
          NAV_FETCH_TIMEOUT_MS
        );
        // Le fetch réseau rafraîchit TOUJOURS le cache quand il aboutit — même
        // si la copie en cache a déjà été servie entre-temps (revalidation).
        // On ne garde en repli que les vraies pages OK (pas les
        // redirections/erreurs), pour un repli hors-ligne fidèle.
        const network = fetch(req, { signal: controller.signal })
          .then((res) => {
            if (res && res.ok) runtime.put(req, res.clone());
            return res;
          })
          .finally(() => clearTimeout(hardTimer));
        try {
          if (cachedPage) {
            // COURSE : réponse fraîche si le réseau tient dans NAV_RACE_MS,
            // sinon la copie en cache TOUT DE SUITE — le réseau continue en
            // arrière-plan (waitUntil) et mettra le cache à jour.
            const winner = await Promise.race([
              network.catch(() => null),
              new Promise((resolve) =>
                setTimeout(() => resolve("cache"), NAV_RACE_MS)
              ),
            ]);
            if (winner && winner !== "cache") return winner;
            event.waitUntil(network.catch(() => {}));
            return cachedPage;
          }
          return await network;
        } catch {
          const precache = await caches.open(PRECACHE_CACHE);
          const offline = await precache.match(OFFLINE_URL);
          // Dernier recours (si `/offline` n'a pas pu être précaché) : plus jamais
          // un « Offline » brut en texte blanc — une page de marque minimale,
          // cohérente avec le reste (auto-rechargement au retour du réseau).
          return (
            offline ||
            new Response(
              '<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1,viewport-fit=cover"><title>Hors ligne — Coligo</title><style>html,body{margin:0;height:100%}body{display:flex;align-items:center;justify-content:center;background:#f7f7fb;color:#1a1a2e;font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;padding:24px;text-align:center}.c{max-width:340px}.i{width:56px;height:56px;margin:0 auto 16px;border-radius:50%;background:#efeaff;display:flex;align-items:center;justify-content:center}h1{font-size:20px;font-weight:800;margin:0 0 8px}p{color:#6b6b80;font-size:14px;line-height:1.5;margin:0 0 20px}button{appearance:none;border:0;background:#6c2bd9;color:#fff;font:600 14px/1 inherit;padding:13px 22px;border-radius:12px;cursor:pointer}</style></head><body><div class="c"><div class="i"><svg width="26" height="26" viewBox="0 0 24 24" fill="none" stroke="#6c2bd9" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M2 8.82a15 15 0 0 1 20 0M5 12.859a10 10 0 0 1 14 0M8.5 16.429a5 5 0 0 1 7 0"/><line x1="1" y1="1" x2="23" y2="23"/><line x1="12" y1="20" x2="12.01" y2="20"/></svg></div><h1>Pas de connexion</h1><p>Vérifiez votre Wi-Fi ou vos données mobiles. On réessaie tout seul dès le retour du réseau.</p><button onclick="location.reload()">Réessayer</button></div><script>addEventListener("online",function(){location.reload()})</script></body></html>',
              {
                status: 503,
                headers: { "Content-Type": "text/html; charset=utf-8" },
              }
            )
          );
        }
      })()
    );
    return;
  }

  // Assets statiques → cache-first.
  if (isStaticAsset(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(RUNTIME_CACHE);
        const hit = await cache.match(req);
        if (hit) return hit;
        try {
          const res = await fetch(req);
          if (res && res.ok) cache.put(req, res.clone());
          return res;
        } catch {
          return hit || Response.error();
        }
      })()
    );
  }
});
