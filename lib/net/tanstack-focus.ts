"use client";

// =============================================================================
// focusManager TanStack Query branché DERRIÈRE la sonde réseau (anti-gel).
// =============================================================================
// Par défaut, TanStack relance les requêtes périmées dès `visibilitychange` →
// au réveil d'une LONGUE absence, une rafale de Server Actions part sur le
// socket à moitié mort (requêtes fantômes) et, Next sérialisant les actions,
// TOUTE l'app semble gelée (boutons morts, navigation coincée). Ici, après une
// absence ≥ 30 s, on SONDE d'abord la connexion (fetch borné) et on ne notifie
// le « focus » aux QueryClients qu'ensuite — mêmes règles que useResumeResync.
// `focusManager` est un singleton de module : UNE installation couvre tous les
// QueryClients (client, livreur, commerçant, admin).
// =============================================================================

import { focusManager } from "@tanstack/react-query";
import { probeConnectionAlive, waitForConnection } from "./probe";

const PROBE_AFTER_HIDDEN_MS = 30_000;

let installed = false;

export function installProbedFocusManager(): void {
  if (installed || typeof document === "undefined") return;
  installed = true;

  let hiddenAt: number | null = null;

  focusManager.setEventListener((handleFocus) => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt = Date.now();
        handleFocus(false);
        return;
      }
      const hiddenFor = hiddenAt ? Date.now() - hiddenAt : 0;
      hiddenAt = null;
      if (hiddenFor < PROBE_AFTER_HIDDEN_MS) {
        handleFocus(true); // micro-bascule : comportement natif, zéro latence
        return;
      }
      // Longue absence : réveiller le réseau avant la rafale de refetchs. Si la
      // sonde n'aboutit pas, on notifie quand même après les retentatives —
      // mieux vaut un refetch tardif (socket réinitialisé) que des données
      // périmées pour toujours.
      void (async () => {
        const ok =
          (await probeConnectionAlive()) || (await waitForConnection(2));
        void ok;
        if (document.visibilityState === "visible") handleFocus(true);
      })();
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  });
}
