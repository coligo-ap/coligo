"use client";

import { getPushTokenSilent } from "./push";
import { isValidWilaya } from "@/lib/marketing/geo-topics";

const LAST_WILAYA_KEY = "coligo:marketing:wilaya";

/**
 * Abonne l'appareil au topic MARKETING de sa wilaya (promos géo), silencieusement
 * et INDÉPENDAMMENT de la connexion. Ne fait rien si :
 *  - pas de wilaya connue / invalide ;
 *  - déjà abonné à cette wilaya (mémo localStorage) → pas d'appel inutile ;
 *  - pas de token push (permission jamais accordée) → best-effort, aucun prompt.
 * Transmet l'ancienne wilaya pour se désabonner en cas de changement de zone.
 */
export async function syncMarketingTopic(wilaya: string | null): Promise<void> {
  try {
    if (typeof window === "undefined") return;
    if (!isValidWilaya(wilaya)) return;
    const prev = window.localStorage.getItem(LAST_WILAYA_KEY);
    if (prev === wilaya) return; // déjà à jour pour cette zone
    const dev = await getPushTokenSilent();
    if (!dev) return; // pas de token (permission non accordée) → retenté plus tard
    const res = await fetch("/api/marketing-topics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: dev.token,
        wilaya,
        prevWilaya: prev && isValidWilaya(prev) ? prev : null,
      }),
    });
    if (res.ok) window.localStorage.setItem(LAST_WILAYA_KEY, wilaya);
  } catch {
    /* best-effort : le marketing ne doit jamais gêner l'app */
  }
}
