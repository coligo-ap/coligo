"use client";

import { useEffect, useRef } from "react";

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
 * Écoute `visibilitychange` (lock / changement d'app), `pageshow` (retour
 * bfcache), `focus` et `online`. Debounce 600 ms car ces évènements arrivent
 * souvent groupés à la reprise. Ne déclenche QUE si la page est réellement
 * visible (un blur de fenêtre desktop ne doit pas re-synchroniser).
 */
export function useResumeResync(onResume: () => void): void {
  const ref = useRef(onResume);
  useEffect(() => {
    ref.current = onResume;
  });
  useEffect(() => {
    let last = 0;
    const fire = () => {
      if (
        typeof document !== "undefined" &&
        document.visibilityState !== "visible"
      )
        return;
      const now = Date.now();
      if (now - last < 600) return; // coalesce visibilitychange + focus + pageshow
      last = now;
      ref.current();
    };
    document.addEventListener("visibilitychange", fire);
    window.addEventListener("pageshow", fire);
    window.addEventListener("focus", fire);
    window.addEventListener("online", fire);
    return () => {
      document.removeEventListener("visibilitychange", fire);
      window.removeEventListener("pageshow", fire);
      window.removeEventListener("focus", fire);
      window.removeEventListener("online", fire);
    };
  }, []);
}
