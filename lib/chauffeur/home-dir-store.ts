"use client";

import { useSyncExternalStore } from "react";
import { HOME_DIR_KEY } from "@/lib/drive/geo";

/**
 * Store RÉACTIF du filtre « Je rentre chez moi » (chauffeur). Auparavant l'état
 * vivait en localStorage lu UNIQUEMENT au montage de chaque écran → l'écran
 * Demandes ne reflétait pas un changement fait ailleurs (ou au retour depuis le
 * cache de navigation). Désormais c'est un store partagé (même mécanique que le
 * rayon « ma zone », cf. work-zone.ts) : toute bascule met à jour LIVE tous les
 * écrans abonnés (Accueil + Demandes), sans dépendre d'un remontage.
 *
 * On conserve la même clé localStorage `HOME_DIR_KEY` (rétro-compat + persistance
 * entre sessions). Le filtre lui-même reste un filtre d'AFFICHAGE côté client :
 * l'app récupère toujours toutes les courses proches ; ce flag ne fait que
 * masquer celles qui ne vont pas vers le domicile.
 */

let on: boolean | undefined = undefined;
const listeners = new Set<() => void>();

function read(): boolean {
  if (typeof window === "undefined") return false;
  if (on === undefined) {
    try {
      on = localStorage.getItem(HOME_DIR_KEY) === "1";
    } catch {
      on = false;
    }
  }
  return on;
}

function emit() {
  for (const l of listeners) l();
}

export function getHomeDirOn(): boolean {
  return read();
}

export function setHomeDirOn(next: boolean) {
  if (typeof window === "undefined") return;
  on = next;
  try {
    localStorage.setItem(HOME_DIR_KEY, next ? "1" : "0");
  } catch {
    /* localStorage indispo → on garde l'état en mémoire */
  }
  emit();
}

export function useHomeDirOn(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => read(),
    () => false
  );
}
