"use client";

import { useEffect, useState } from "react";

/**
 * Détecte si le navigateur est en ligne.
 *
 * - écoute `online` / `offline` (instantané quand l'OS détecte le changement),
 * - démarre dans l'état `navigator.onLine` à l'hydratation,
 * - retourne `true` côté serveur (= valeur neutre, le composant doit ré-render
 *   après hydratation côté client).
 *
 * `navigator.onLine` peut mentir (« connecté » sans vraie connectivité Internet)
 * mais c'est volontaire ici : pour le MVP on se contente du signal système ;
 * la file rejouera de toute façon les actions et retombera en `failed` si le
 * serveur n'est pas joignable. Inutile d'ajouter un ping qui consomme du
 * réseau Algérie pour rien.
 */
export function useOnlineStatus(): boolean {
  // Valeur initiale SSR-safe : on suppose online ; ça évite un flash de
  // bandeau « hors ligne » au montage en SSR/SSG.
  const [online, setOnline] = useState<boolean>(true);

  useEffect(() => {
    if (typeof window === "undefined") return;

    setOnline(navigator.onLine);

    const handleOnline = () => setOnline(true);
    const handleOffline = () => setOnline(false);

    window.addEventListener("online", handleOnline);
    window.addEventListener("offline", handleOffline);

    return () => {
      window.removeEventListener("online", handleOnline);
      window.removeEventListener("offline", handleOffline);
    };
  }, []);

  return online;
}
