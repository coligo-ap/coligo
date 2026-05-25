"use client";

import { useCallback, useEffect, useState } from "react";

const KEY = "coligo-merchant-prefs";

export type MerchantPrefs = {
  /** Joue un son à la réception d'une nouvelle commande. */
  alertSound: boolean;
  /** Affiche une notification système (app ouverte). */
  notifications: boolean;
  /**
   * Mode comptoir : l'app reste vigilante pour qu'aucune commande ne soit
   * ratée pendant le service.
   *  - garde l'écran allumé (Wake Lock si supporté) ;
   *  - rejoue le son d'alerte en boucle ;
   *  - affiche un overlay plein écran sur nouvelle commande.
   * Pensé pour un commerçant qui pose son téléphone/tablette sur le comptoir.
   */
  counterMode: boolean;
};

const DEFAULTS: MerchantPrefs = {
  alertSound: true,
  notifications: true,
  // ON par défaut : on préfère que le commerçant soit alerté de façon
  // insistante par défaut, quitte à ce qu'il désactive le mode comptoir
  // lui-même s'il n'en a pas besoin.
  counterMode: true,
};

function read(): MerchantPrefs {
  if (typeof window === "undefined") return DEFAULTS;
  try {
    const raw = window.localStorage.getItem(KEY);
    if (!raw) return DEFAULTS;
    const parsed = JSON.parse(raw) as Partial<MerchantPrefs>;
    return { ...DEFAULTS, ...parsed };
  } catch {
    return DEFAULTS;
  }
}

/**
 * Préférences locales du commerçant (son d'alerte, notifs). Persistées en
 * `localStorage`. Pas de synchro serveur : chaque appareil garde ses réglages.
 */
export function useMerchantPrefs() {
  const [prefs, setPrefs] = useState<MerchantPrefs>(DEFAULTS);
  const [hydrated, setHydrated] = useState(false);

  useEffect(() => {
    setPrefs(read());
    setHydrated(true);

    // Synchro entre onglets ouverts (le commerçant peut avoir 2 onglets actifs).
    const onStorage = (e: StorageEvent) => {
      if (e.key !== KEY) return;
      setPrefs(read());
    };
    window.addEventListener("storage", onStorage);
    return () => window.removeEventListener("storage", onStorage);
  }, []);

  const update = useCallback((patch: Partial<MerchantPrefs>) => {
    setPrefs((prev) => {
      const next = { ...prev, ...patch };
      try {
        window.localStorage.setItem(KEY, JSON.stringify(next));
      } catch {
        /* ignoré : Safari privé peut bloquer localStorage */
      }
      return next;
    });
  }, []);

  return { prefs, update, hydrated };
}
