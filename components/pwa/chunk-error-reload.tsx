"use client";

import { useEffect } from "react";

/**
 * Filet pour les ChunkLoadError — la cause n°1 du « Application error: a
 * client-side exception » qui n'est PAS attrapée par un error boundary React
 * (l'échec survient au chargement d'un <script>, hors du rendu).
 *
 * Quand ça arrive :
 *  - après un déploiement Vercel, les chunks `_next/static/chunks/*.js` changent
 *    de hash ; un onglet ouvert sur l'ancienne version demande des fichiers qui
 *    n'existent plus → 404 → ChunkLoadError ;
 *  - hors-ligne, un chunk pas encore mis en cache ne peut pas être récupéré.
 *
 * Stratégie :
 *  - EN LIGNE → on recharge UNE fois pour récupérer les chunks à jour (garde
 *    anti-boucle : pas plus d'un reload toutes les 12 s).
 *  - HORS-LIGNE → on ne recharge pas (ça échouerait) ; l'error boundary affiche
 *    l'écran « Pas de connexion ». Au retour du réseau, un reload récupère tout.
 */
const RELOAD_KEY = "coligo_chunk_reload_at";
const RELOAD_COOLDOWN_MS = 12_000;

function isChunkError(value: unknown): boolean {
  const msg =
    value instanceof Error
      ? `${value.name}: ${value.message}`
      : typeof value === "string"
        ? value
        : "";
  return (
    /ChunkLoadError/i.test(msg) ||
    /Loading (CSS )?chunk [\w-]+ failed/i.test(msg) ||
    /(error )?loading dynamically imported module/i.test(msg) ||
    /Failed to fetch dynamically imported module/i.test(msg) ||
    /Importing a module script failed/i.test(msg)
  );
}

function maybeReload() {
  if (typeof window === "undefined") return;
  // Hors-ligne : recharger ne ferait qu'échouer → on laisse l'UI gérer.
  if (!navigator.onLine) return;
  let last = 0;
  try {
    last = parseInt(sessionStorage.getItem(RELOAD_KEY) ?? "0", 10) || 0;
  } catch {
    /* sessionStorage indisponible (mode privé strict) : on recharge quand même */
  }
  const now = Date.now();
  if (now - last < RELOAD_COOLDOWN_MS) return; // évite la boucle de reload
  try {
    sessionStorage.setItem(RELOAD_KEY, String(now));
  } catch {
    /* ignoré */
  }
  window.location.reload();
}

export function ChunkErrorReload() {
  useEffect(() => {
    const onError = (e: ErrorEvent) => {
      if (isChunkError(e.error) || isChunkError(e.message)) maybeReload();
    };
    const onRejection = (e: PromiseRejectionEvent) => {
      if (isChunkError(e.reason)) maybeReload();
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  return null;
}
