"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import type { OrderStatus } from "@/lib/types";

/**
 * S'abonne aux changements de la commande (Realtime) et déclenche un refresh
 * de la page serveur dès que le statut bouge. Pas d'UI propre : juste un hook.
 */
export function CustomerOrderLive({
  orderId,
  initialStatus,
}: {
  orderId: string;
  initialStatus: OrderStatus;
}) {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`customer-order-${orderId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "orders",
          filter: `id=eq.${orderId}`,
        },
        (payload) => {
          const next = (payload.new as { status: OrderStatus }).status;
          if (next !== initialStatus) {
            router.refresh();
          }
        }
      )
      .subscribe();

    // Safety-net : refresh toutes les 30s au cas où le Realtime ne fonctionne pas.
    const interval = setInterval(() => router.refresh(), 30_000);

    return () => {
      clearInterval(interval);
      supabase.removeChannel(channel);
    };
  }, [orderId, initialStatus, router]);

  return null;
}
