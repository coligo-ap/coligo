"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/components/ui/toast";

/**
 * S'abonne en Realtime aux changements des commandes du commerçant et
 * rafraîchit la page (le kanban / la liste se mettent à jour tout seuls).
 *
 * - INSERT d'une commande `pending` → toast « Nouvelle commande ! ».
 * - tout changement (INSERT/UPDATE) → router.refresh().
 *
 * La RLS s'applique aux events Realtime : le commerçant ne reçoit que ses
 * commandes (filtre merchant_id + policies SELECT sur `orders`).
 */
export function OrdersRealtime({ merchantId }: { merchantId: string }) {
  const router = useRouter();

  useEffect(() => {
    const supabase = createClient();
    const channel = supabase
      .channel(`orders:${merchantId}`)
      .on(
        "postgres_changes",
        {
          event: "*",
          schema: "public",
          table: "orders",
          filter: `merchant_id=eq.${merchantId}`,
        },
        (payload) => {
          const next = payload.new as { status?: string } | null;
          if (payload.eventType === "INSERT" && next?.status === "pending") {
            toast.info("🔔 Nouvelle commande !");
          }
          router.refresh();
        }
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
  }, [merchantId, router]);

  return null;
}
