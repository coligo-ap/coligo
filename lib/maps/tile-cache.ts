/**
 * CACHE LOCAL de la carte (tuiles vectorielles + glyphs + sprites + styles
 * OpenFreeMap) — ce que font les grandes apps de VTC/livraison : tout ce que
 * la carte a déjà téléchargé est conservé SUR L'APPAREIL (IndexedDB) et
 * resservi instantanément, même après fermeture de l'app.
 *
 * Pourquoi IndexedDB + `maplibregl.addProtocol` (et PAS un service worker) :
 *  - fonctionne dans les WebViews Capacitor Android ET iOS (WKWebView ne
 *    lance pas toujours les SW d'un domaine distant) et en navigateur ;
 *  - localStorage est exclu (quota ~5 Mo, synchrone) — une tuile fait
 *    10-60 Ko et on en garde des milliers ;
 *  - le protocole intercepte TOUTES les ressources du style (tuiles .pbf,
 *    glyphs, sprites, TileJSON) sans toucher au reste de l'app.
 *
 * Stratégie : cache-first avec TTL (30 j tuiles/glyphs/sprites, 7 j JSON de
 * style/TileJSON) + REPLI HORS-LIGNE (une entrée périmée est resservie si le
 * réseau échoue) + LRU borné (~4 500 entrées, purge des plus anciennes).
 * Gains : affichage quasi instantané dès la 2e visite d'une zone, data
 * mobile économisée, carte encore lisible en tunnel/zone blanche.
 */

const DB_NAME = "coligo-map-cache";
const STORE = "assets";
const PROTOCOL = "cached";
/** Tuiles/glyphs/sprites : contenu quasi immuable chez OpenFreeMap. */
const TTL_STATIC_MS = 30 * 24 * 3600_000;
/** JSON (style, TileJSON) : peut évoluer (nouvelles couches) → plus court. */
const TTL_JSON_MS = 7 * 24 * 3600_000;
const MAX_ENTRIES = 4_500;
const TRIM_BATCH = 500;

type Entry = { url: string; buf: ArrayBuffer; ts: number };

let dbPromise: Promise<IDBDatabase | null> | null = null;
function openDb(): Promise<IDBDatabase | null> {
  if (typeof indexedDB === "undefined") return Promise.resolve(null);
  if (!dbPromise) {
    dbPromise = new Promise((resolve) => {
      try {
        const req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = () => {
          const store = req.result.createObjectStore(STORE, {
            keyPath: "url",
          });
          store.createIndex("ts", "ts");
        };
        req.onsuccess = () => resolve(req.result);
        req.onerror = () => resolve(null);
      } catch {
        resolve(null);
      }
    });
  }
  return dbPromise;
}

async function idbGet(url: string): Promise<Entry | null> {
  const db = await openDb();
  if (!db) return null;
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).get(url);
      req.onsuccess = () => resolve((req.result as Entry) ?? null);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

let putsSinceTrim = 0;
async function idbPut(url: string, buf: ArrayBuffer): Promise<void> {
  const db = await openDb();
  if (!db) return;
  try {
    db.transaction(STORE, "readwrite")
      .objectStore(STORE)
      .put({ url, buf, ts: Date.now() } satisfies Entry);
  } catch {
    /* quota plein / privé strict → la carte reste 100 % réseau */
  }
  // Purge LRU périodique (pas à chaque écriture — count() a un coût).
  if (++putsSinceTrim >= 40) {
    putsSinceTrim = 0;
    void trim(db);
  }
}

function trim(db: IDBDatabase) {
  try {
    const store = db.transaction(STORE, "readwrite").objectStore(STORE);
    const count = store.count();
    count.onsuccess = () => {
      if (count.result <= MAX_ENTRIES) return;
      let left = Math.min(TRIM_BATCH, count.result - MAX_ENTRIES);
      const cur = store.index("ts").openCursor(); // plus anciens d'abord
      cur.onsuccess = () => {
        const c = cur.result;
        if (!c || left-- <= 0) return;
        c.delete();
        c.continue();
      };
    };
  } catch {
    /* best-effort */
  }
}

/**
 * Préfixe une URL https avec le protocole de cache — SANS schéma imbriqué :
 * `cached://tiles.openfreemap.org/…` (et pas `cached://https://…`). MapLibre
 * normalise les URLs de SPRITE via `new URL()` : un double « :// » y est
 * détruit et la requête partait résolue contre l'origine de la page
 * (https://coligo.app/https//…). Le handler reconstruit le https://.
 */
function pfx(url: string): string {
  return url.startsWith("https://")
    ? `${PROTOCOL}://${url.slice("https://".length)}`
    : url;
}

/**
 * Réécrit un style MapLibre pour que TOUTES ses ressources (glyphs, sprites,
 * TileJSON / tuiles) passent par le protocole de cache. À appeler UNE fois
 * sur le style fraîchement chargé, avant de le donner aux cartes.
 */
export function withCachedUrls(styleRaw: unknown): unknown {
  const style = styleRaw as {
    glyphs?: string;
    sprite?: string | { id: string; url: string }[];
    sources?: Record<string, { url?: string; tiles?: string[] }>;
  };
  if (!style || typeof style !== "object") return styleRaw;
  if (typeof style.glyphs === "string") style.glyphs = pfx(style.glyphs);
  if (typeof style.sprite === "string") style.sprite = pfx(style.sprite);
  else if (Array.isArray(style.sprite))
    style.sprite = style.sprite.map((s) => ({ ...s, url: pfx(s.url) }));
  for (const src of Object.values(style.sources ?? {})) {
    if (typeof src.url === "string") src.url = pfx(src.url);
    if (Array.isArray(src.tiles)) src.tiles = src.tiles.map(pfx);
  }
  return style;
}

type ProtocolParams = { url: string; type?: string };

function decodeJson(buf: ArrayBuffer): unknown {
  const parsed = JSON.parse(new TextDecoder().decode(buf)) as {
    tiles?: unknown;
  };
  // TileJSON : ses URLs de tuiles doivent AUSSI passer par le cache, sinon
  // seules les métadonnées seraient cachées et les tuiles repartiraient en
  // direct sur le réseau.
  if (Array.isArray(parsed.tiles))
    parsed.tiles = parsed.tiles.map((t) =>
      typeof t === "string" ? pfx(t) : t
    );
  return parsed;
}

let registered = false;
/**
 * Enregistre le protocole `cached://` (une seule fois par session) — à
 * appeler avec le module maplibre-gl AVANT de créer une carte.
 */
export function registerMapCacheProtocol(maplibre: {
  addProtocol: (
    scheme: string,
    handler: (
      params: ProtocolParams,
      abort: AbortController
    ) => Promise<{ data: unknown }>
  ) => void;
}): void {
  if (registered || typeof window === "undefined") return;
  registered = true;
  maplibre.addProtocol(PROTOCOL, async (params, abort) => {
    const real = "https://" + params.url.slice(PROTOCOL.length + 3);
    const isJson = params.type === "json";
    const ttl = isJson ? TTL_JSON_MS : TTL_STATIC_MS;
    const hit = await idbGet(real);
    if (hit && Date.now() - hit.ts < ttl)
      return { data: isJson ? decodeJson(hit.buf) : hit.buf };
    try {
      const res = await fetch(real, { signal: abort.signal });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const buf = await res.arrayBuffer();
      void idbPut(real, buf);
      return { data: isJson ? decodeJson(buf) : buf };
    } catch (e) {
      // Hors-ligne / CDN en panne : mieux vaut une tuile périmée qu'un trou.
      if (hit) return { data: isJson ? decodeJson(hit.buf) : hit.buf };
      throw e;
    }
  });
}

/**
 * fetch JSON passant par le même cache (utilisé pour le STYLE de la carte :
 * démarrage instantané dès la 2e session, même hors-ligne).
 */
export async function fetchJsonCached(url: string): Promise<unknown | null> {
  const hit = await idbGet(url);
  if (hit && Date.now() - hit.ts < TTL_JSON_MS) {
    try {
      return JSON.parse(new TextDecoder().decode(hit.buf));
    } catch {
      /* entrée corrompue → réseau */
    }
  }
  try {
    const res = await fetch(url);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const buf = await res.arrayBuffer();
    void idbPut(url, buf);
    return JSON.parse(new TextDecoder().decode(buf));
  } catch {
    if (hit) {
      try {
        return JSON.parse(new TextDecoder().decode(hit.buf));
      } catch {
        return null;
      }
    }
    return null;
  }
}
