/* Coligo — Service Worker (hand-rolled, sans dépendance).
 *
 * Stratégies :
 *  - navigations HTML            → network-first, fallback `/offline`
 *  - assets statiques Next/icônes → cache-first
 *  - API/Supabase/RSC            → JAMAIS cachés (données fraîches)
 *
 * Bump CACHE_VERSION pour invalider tout le cache à un nouveau déploiement.
 */
// v4 : invalidation forcée pour purger les anciens chunks _next/static/
// (PrintOrderButton servait l'ancien JS côté WebView Sunmi → click Imprimer
// continuait à naviguer vers /print/orders/[id] au lieu d'appeler le pont
// Sunmi natif).
const CACHE_VERSION = "coligo-v4";
const RUNTIME_CACHE = `${CACHE_VERSION}-runtime`;
const PRECACHE_CACHE = `${CACHE_VERSION}-precache`;
const OFFLINE_URL = "/offline";
const PRECACHE_URLS = [
  OFFLINE_URL,
  "/manifest.webmanifest",
  "/icon-192.png",
  "/icon-512.png",
  "/icon-maskable-512.png",
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
    url.pathname.startsWith("/icon-") ||
    url.pathname === "/favicon-32.png" ||
    url.pathname === "/apple-touch-icon.png" ||
    url.pathname === "/manifest.webmanifest"
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

  // Navigations (documents HTML) → network-first, fallback offline.
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          return res;
        } catch {
          const cache = await caches.open(PRECACHE_CACHE);
          const offline = await cache.match(OFFLINE_URL);
          return (
            offline ||
            new Response("Offline", {
              status: 503,
              headers: { "Content-Type": "text/plain; charset=utf-8" },
            })
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
