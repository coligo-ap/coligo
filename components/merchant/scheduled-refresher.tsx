"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";

/**
 * Déclenche un `router.refresh()` quand la PROCHAINE commande programmée atteint
 * sa « fire time » → elle bascule alors dans le board actif (bascule DÉRIVÉE
 * côté serveur ; ce timer ne fait que rafraîchir l'écran, il n'a rien à
 * « survivre » : au remontage on recalcule tout). Filet : refresh toutes les
 * 60 s tant qu'il reste des commandes à venir.
 */
export function ScheduledRefresher({
  nextFireAtIso,
}: {
  nextFireAtIso: string;
}) {
  const router = useRouter();
  useEffect(() => {
    const fireMs = new Date(nextFireAtIso).getTime() - Date.now();
    const timers: ReturnType<typeof setTimeout>[] = [];
    if (fireMs > 0 && fireMs < 24 * 60 * 60_000) {
      timers.push(setTimeout(() => router.refresh(), fireMs + 1000));
    }
    const interval = setInterval(() => router.refresh(), 60_000);
    return () => {
      timers.forEach(clearTimeout);
      clearInterval(interval);
    };
  }, [nextFireAtIso, router]);
  return null;
}
