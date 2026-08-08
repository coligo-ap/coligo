"use client";

import { useEffect, useState } from "react";
import { cn } from "@/lib/utils";

/**
 * Attention « commandes » partagée par la nav commerçant (bottom-nav mobile +
 * sidebar desktop) : combien de commandes exigent une action MAINTENANT.
 *
 *  - pending : TOUTE commande à confirmer (elle risque l'auto-refus à 15 min) ;
 *  - late    : commande en préparation dont l'heure « prête pour »
 *              (pickup_slot_at) est dépassée d'au moins 1 min.
 *
 * Les lignes viennent du Server Component (MerchantShell) — elles se
 * re-synchronisent à chaque `router.refresh()` du pont Realtime, donc le badge
 * suit les commandes en direct depuis n'importe quelle page. Le retard, lui,
 * avance avec une horloge CLIENT (tick 30 s, `null` avant montage pour ne pas
 * créer de mismatch d'hydratation).
 */
export type AlertOrderLite = {
  status: string;
  created_at: string;
  pickup_slot_at: string;
};

export function useOrderAttention(orders: AlertOrderLite[]): {
  pending: number;
  late: number;
} {
  const [now, setNow] = useState<number | null>(null);
  useEffect(() => {
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 30_000);
    return () => clearInterval(t);
  }, []);

  const pending = orders.filter((o) => o.status === "pending").length;
  const late =
    now === null
      ? 0
      : orders.filter(
          (o) =>
            (o.status === "accepted" || o.status === "preparing") &&
            now - new Date(o.pickup_slot_at).getTime() >= 60_000
        ).length;
  return { pending, late };
}

/** Pastille rouge clignotante (compteur) — rien si aucune action à faire. */
export function NavAlertBadge({
  orders,
  className,
}: {
  orders: AlertOrderLite[];
  className?: string;
}) {
  const { pending, late } = useOrderAttention(orders);
  const total = pending + late;
  if (total === 0) return null;
  return (
    <span
      className={cn(
        "bg-danger-500 text-micro inline-flex min-w-[18px] animate-pulse items-center justify-center rounded-full px-1 py-0.5 leading-none font-extrabold text-white tabular-nums",
        className
      )}
    >
      {total}
    </span>
  );
}
