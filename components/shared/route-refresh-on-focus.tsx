"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";

/**
 * Rafraîchissement DOUX en arrière-plan, complément du Router Cache
 * (`experimental.staleTimes`).
 *
 * Quand l'onglet / l'app revient au premier plan après avoir été masqué un
 * certain temps (changement d'app sur APK, retour sur l'onglet…), on
 * re-synchronise les données du Server Component COURANT via `router.refresh()`.
 * C'est un refresh SOUPLE : il re-streame le RSC et réconcilie, SANS démonter la
 * page ni vider l'état des composants client (pas de flash `loading.tsx`, scroll
 * et saisies préservés). On ne recharge donc QUE ce qui a changé côté serveur,
 * de façon asynchrone — exactement le « stale-while-revalidate » souhaité.
 *
 * Garde-fou : on ne rafraîchit que si l'app a été masquée au moins `minHiddenMs`
 * (par défaut 10 s) → pas de refresh inutile sur les micro-bascules.
 */
export function RouteRefreshOnFocus({
  minHiddenMs = 10_000,
}: {
  minHiddenMs?: number;
}) {
  const router = useRouter();
  const hiddenAt = useRef<number | null>(null);

  useEffect(() => {
    const onVisibility = () => {
      if (document.visibilityState === "hidden") {
        hiddenAt.current = Date.now();
        return;
      }
      // Revenu au premier plan.
      if (hiddenAt.current && Date.now() - hiddenAt.current >= minHiddenMs) {
        router.refresh();
      }
      hiddenAt.current = null;
    };
    document.addEventListener("visibilitychange", onVisibility);
    return () => document.removeEventListener("visibilitychange", onVisibility);
  }, [router, minHiddenMs]);

  return null;
}
