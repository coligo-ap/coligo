"use client";

import { useSyncExternalStore } from "react";

/**
 * Intention « EN LIGNE » du chauffeur — source de vérité unique, persistée en
 * localStorage et partagée dans tout l'espace Drive (sans context), façon
 * `lib/driver/online-store.ts`.
 *
 * Le chauffeur n'est À L'ÉCOUTE des demandes de course que s'il est EN LIGNE :
 * tant qu'il est hors ligne, aucune page ne poll / ne s'abonne au temps réel /
 * n'envoie de heartbeat « en ligne » → il n'apparaît pas dans le dispatch et ne
 * reçoit aucune demande. Il bascule via le bouton GO (accueil ou page demandes).
 *
 * NB : la clé est partagée avec l'état serveur (`chauffeur_presence.is_online`,
 * mis à jour par `setChauffeurOnline` + le heartbeat). Le store ne gère que
 * l'INTENTION côté client ; la présence serveur suit.
 */
const KEY = "coligo-drive-online";

let online: boolean | null = null; // null = pas encore lu depuis localStorage
const listeners = new Set<() => void>();

function read(): boolean {
  if (typeof window === "undefined") return false;
  if (online === null) online = localStorage.getItem(KEY) === "1";
  return online;
}

function emit() {
  for (const l of listeners) l();
}

export function getChauffeurOnlineLocal(): boolean {
  return read();
}

export function setChauffeurOnlineLocal(next: boolean) {
  if (typeof window === "undefined") return;
  if (read() === next) return;
  online = next;
  try {
    localStorage.setItem(KEY, next ? "1" : "0");
  } catch {
    /* localStorage indispo → on garde l'état en mémoire */
  }
  emit();
}

export function useChauffeurOnline(): boolean {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => read(),
    () => false
  );
}
