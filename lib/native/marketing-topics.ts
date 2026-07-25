"use client";

import { getPushTokenSilent } from "./push";
import { isValidWilaya } from "@/lib/marketing/geo-topics";

/** Mémo JSON `{ w, t }` : wilaya abonnée + queue du token abonné. */
const SYNC_KEY = "coligo:marketing:sync";
/** Ancien mémo (wilaya seule) — migré : il masquait les rotations de token. */
const LEGACY_KEY = "coligo:marketing:wilaya";

/** Émis par push.ts après un enregistrement réussi (permission accordée). */
export const PUSH_READY_EVENT = "coligo:push-token-registered";

type SyncMemo = { w: string; t: string };

function readMemo(): SyncMemo | null {
  try {
    const raw = window.localStorage.getItem(SYNC_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<SyncMemo>;
      if (typeof parsed.w === "string" && typeof parsed.t === "string") {
        return { w: parsed.w, t: parsed.t };
      }
    }
    // Migration : l'ancien mémo ne retenait QUE la wilaya → si le token FCM
    // tournait (réinstall, rotation web), le nouveau token n'était JAMAIS
    // abonné et les promos s'arrêtaient en silence. On le convertit en mémo
    // « wilaya connue, token inconnu » : la prochaine sync ré-abonne le token
    // courant (idempotent côté FCM) tout en gardant la wilaya pour le
    // désabonnement en cas de changement de zone.
    const legacy = window.localStorage.getItem(LEGACY_KEY);
    if (legacy && isValidWilaya(legacy)) return { w: legacy, t: "" };
  } catch {
    /* localStorage indisponible */
  }
  return null;
}

/**
 * Abonne l'appareil au topic MARKETING de sa wilaya (promos géo), silencieusement
 * et INDÉPENDAMMENT de la connexion. Ne fait rien si :
 *  - pas de wilaya connue / invalide ;
 *  - déjà abonné à cette wilaya AVEC ce token (mémo) → pas d'appel inutile ;
 *  - pas de token push (permission jamais accordée) → best-effort, aucun prompt.
 * Re-synchronise quand la wilaya change OU quand le token change (rotation,
 * permission accordée après coup — cf. PUSH_READY_EVENT écouté par MarketingPush).
 */
export async function syncMarketingTopic(wilaya: string | null): Promise<void> {
  try {
    if (typeof window === "undefined") return;
    if (!isValidWilaya(wilaya)) return;
    const dev = await getPushTokenSilent();
    if (!dev) return; // pas de token (permission non accordée) → retenté plus tard
    const tail = dev.token.slice(-48);
    const prev = readMemo();
    if (prev && prev.w === wilaya && prev.t === tail) return; // déjà à jour
    const res = await fetch("/api/marketing-topics", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        token: dev.token,
        wilaya,
        prevWilaya:
          prev && prev.w !== wilaya && isValidWilaya(prev.w) ? prev.w : null,
      }),
    });
    if (res.ok) {
      window.localStorage.setItem(
        SYNC_KEY,
        JSON.stringify({ w: wilaya, t: tail } satisfies SyncMemo)
      );
      window.localStorage.removeItem(LEGACY_KEY);
    }
  } catch {
    /* best-effort : le marketing ne doit jamais gêner l'app */
  }
}
