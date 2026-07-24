"use client";

import { useEffect, useRef } from "react";
import { probeConnectionAlive, waitForConnection } from "@/lib/net/probe";

/**
 * Exécute `onResume` quand l'app REVIENT au premier plan après être passée en
 * arrière-plan : téléphone verrouillé puis déverrouillé, bascule vers une autre
 * app (Instagram…), onglet/navigateur inactif, page restaurée du bfcache, ou
 * réseau revenu.
 *
 * POURQUOI — robustesse arrière-plan (règle permanente, voir CLAUDE.md) : en
 * arrière-plan, le navigateur THROTTLE les timers (setInterval/Timeout) et FERME
 * souvent les WebSockets (Supabase Realtime). À la reprise, l'état client est
 * donc PÉRIMÉ : une course a pu être acceptée/annulée/terminée pendant l'absence,
 * et la 1ʳᵉ requête réseau part sur une connexion « froide ». Il faut IMPÉRATIVE-
 * MENT re-synchroniser l'état serveur à la reprise — sinon « quitter l'app puis
 * revenir » laisse un écran figé sur un état faux et l'action suivante (annuler,
 * accepter…) traîne ou agit sur un état périmé.
 *
 * ⚠️ ANTI-GEL (bug vécu : « je reviens après 20 min et TOUT est bloqué ») :
 * après une LONGUE absence, le socket keep-alive est souvent à moitié mort — la
 * première requête part en FANTÔME (ne résout ni n'échoue). Les callbacks de
 * resync déclenchent des Server Actions, et Next les SÉRIALISE : un resync
 * fantôme au réveil bloquait la file entière (boutons morts, navigation
 * coincée). Donc, après une absence ≥ `PROBE_AFTER_HIDDEN_MS`, on SONDE d'abord
 * la connexion (fetch borné, abortable — voir lib/net/probe) et on ne lance les
 * resyncs QU'UNE FOIS le réseau confirmé vivant (avec retentatives). Les
 * micro-bascules (< 30 s) restent instantanées, sans sonde.
 *
 * Écoute `visibilitychange` (lock / changement d'app), `pageshow` (retour
 * bfcache), `focus` et `online`. Debounce 600 ms car ces évènements arrivent
 * souvent groupés à la reprise. Ne déclenche QUE si la page est réellement
 * visible (un blur de fenêtre desktop ne doit pas re-synchroniser).
 */

/** Absence au-delà de laquelle on ne fait plus confiance au socket. */
const PROBE_AFTER_HIDDEN_MS = 30_000;

export function useResumeResync(onResume: (hiddenForMs: number) => void): void {
  const ref = useRef(onResume);
  useEffect(() => {
    ref.current = onResume;
  });
  useEffect(() => {
    let last = 0;
    let hiddenAt: number | null = null;
    let probing = false;

    const fire = () => {
      if (
        typeof document !== "undefined" &&
        document.visibilityState !== "visible"
      )
        return;
      const now = Date.now();
      if (now - last < 600) return; // coalesce visibilitychange + focus + pageshow
      last = now;

      const hiddenFor = hiddenAt ? now - hiddenAt : 0;
      hiddenAt = null;
      if (hiddenFor < PROBE_AFTER_HIDDEN_MS) {
        // Micro-bascule : socket présumé sain → resync immédiat (comportement
        // historique, zéro latence ajoutée).
        ref.current(hiddenFor);
        return;
      }

      // Longue absence : réveiller le réseau AVANT de tirer les resyncs.
      if (probing) return;
      probing = true;
      void (async () => {
        try {
          // 1re sonde rapide, puis retentatives — et si le réseau ne confirme
          // toujours pas, on tire quand même : mieux vaut un resync tardif qui
          // échoue vite (socket réinitialisé entre-temps) que jamais.
          const ok =
            (await probeConnectionAlive()) || (await waitForConnection(2));
          if (!ok && document.visibilityState !== "visible") return;
        } finally {
          probing = false;
        }
        ref.current(hiddenFor);
      })();
    };

    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        return;
      }
      fire();
    };

    document.addEventListener("visibilitychange", onVisibility);
    window.addEventListener("pageshow", fire);
    window.addEventListener("focus", fire);
    window.addEventListener("online", fire);
    return () => {
      document.removeEventListener("visibilitychange", onVisibility);
      window.removeEventListener("pageshow", fire);
      window.removeEventListener("focus", fire);
      window.removeEventListener("online", fire);
    };
  }, []);
}
