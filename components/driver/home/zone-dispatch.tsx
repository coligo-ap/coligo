"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useDriverPosition } from "@/lib/native/use-driver-position";
import { pullNextExpressNearby } from "@/app/(driver)/actions";
import { toast } from "@/components/ui/toast";

/**
 * Dispatch par ZONE (réception Express GLOBALE). Quand le livreur est EN LIGNE,
 * tente d'attribuer une commande express d'un commerçant proche (RPC
 * géographique pull_next_express_nearby) — SANS aucune inscription chez le
 * commerçant. À l'attribution, on route vers /driver/course/[orderId] (course
 * autonome) : le flux éprouvé (offre qui sonne → course → validation) prend le
 * relais. Monté globalement dans le layout livreur → la réception fonctionne
 * sur n'importe quelle page tant qu'il est en ligne.
 *
 * Déclencheurs : Realtime sur les commandes express (réception ~instantanée) +
 * repli polling 20 s (le timing intelligent rend une commande attribuable à son
 * prep_notif_at, sans évènement Realtime à cet instant précis). La RPC est
 * idempotente et ne fait rien si le livreur a déjà une course → poll sûr.
 */
export function ZoneDispatch({ online }: { online: boolean }) {
  const coords = useDriverPosition();
  const router = useRouter();
  const coordsRef = useRef(coords);
  coordsRef.current = coords;
  const busy = useRef(false);
  const tickRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!online) return;
    let alive = true;

    const tick = async () => {
      const c = coordsRef.current;
      if (!alive || busy.current || !c) return;
      busy.current = true;
      try {
        const r = await pullNextExpressNearby(c.latitude, c.longitude);
        if (alive && r.orderId) {
          toast.success("Nouvelle course à proximité ⚡");
          router.push(`/driver/course/${r.orderId}`);
        }
      } finally {
        busy.current = false;
      }
    };
    tickRef.current = tick;

    void tick();
    const poll = setInterval(tick, 20_000);

    // Realtime : réagit aux commandes express (création / passage prêt).
    const supabase = createClient();
    const channel = supabase
      .channel("driver-zone-dispatch")
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "orders",
          filter: "delivery_mode=eq.express",
        },
        () => void tickRef.current()
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "orders",
          filter: "delivery_mode=eq.express",
        },
        () => void tickRef.current()
      )
      .subscribe();

    return () => {
      alive = false;
      clearInterval(poll);
      void supabase.removeChannel(channel);
    };
  }, [online, router]);

  return null;
}
