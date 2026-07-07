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
const CACHE_VERSION = "coligo-v18";
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

  // Navigations (documents HTML) → network-first strict : le réseau fait foi
  // (jamais de page périmée si le serveur répond). En cas d'échec réseau
  // uniquement : dernière copie de CETTE page en cache, sinon `/offline`.
  if (req.mode === "navigate") {
    event.respondWith(
      (async () => {
        try {
          const res = await fetch(req);
          // On ne garde en repli que les vraies pages OK (pas les
          // redirections/erreurs), pour un repli hors-ligne fidèle.
          if (res && res.ok) {
            const cache = await caches.open(RUNTIME_CACHE);
            cache.put(req, res.clone());
          }
          return res;
        } catch {
          const runtime = await caches.open(RUNTIME_CACHE);
          const cachedPage = await runtime.match(req);
          if (cachedPage) return cachedPage;
          const precache = await caches.open(PRECACHE_CACHE);
          const offline = await precache.match(OFFLINE_URL);
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
