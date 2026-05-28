"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { toast } from "@/components/ui/toast";

/**
 * Alerte temps réel du tableau de bord livreur : quand une nouvelle livraison
 * (Express ou Tournée) arrive chez l'un de ses commerçants, on rafraîchit les
 * compteurs et on affiche un toast. La RLS limite déjà les commandes reçues
 * aux commerçants du livreur, donc on s'abonne largement sans filtre fragile.
 *
 * Filet de sécurité : refresh toutes les 20 s si le Realtime ne passe pas.
 */
export function DriverDashboardLive() {
  const router = useRouter();
  const lastToastRef = useRef(0);

  useEffect(() => {
    const supabase = createClient();

    const onDeliveryChange = (mode: string | null) => {
      router.refresh();
      // Anti-spam : un toast au plus toutes les 8 s.
      const now = Date.now();
      if (now - lastToastRef.current > 8000) {
        lastToastRef.current = now;
        toast.success(
          mode === "tour"
            ? "Nouvelle commande en tournée 📅"
            : "Nouvelle course Express disponible ⚡"
        );
      }
    };

    const channel = supabase
      .channel("driver-dashboard-deliveries")
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "orders" },
        (p) => {
          const r = p.new as {
            fulfillment_type?: string;
            delivery_mode?: string;
          };
          if (r.fulfillment_type === "delivery")
            onDeliveryChange(r.delivery_mode ?? null);
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "orders" },
        (p) => {
          const r = p.new as {
            fulfillment_type?: string;
            delivery_mode?: string;
            status?: string;
            delivery_driver_id?: string | null;
          };
          // On alerte surtout quand une course devient dispo (prête + sans
          // livreur). Les autres updates rafraîchissent juste les compteurs.
          if (r.fulfillment_type !== "delivery") return;
          if (r.status === "ready" && r.delivery_driver_id == null) {
            onDeliveryChange(r.delivery_mode ?? null);
          } else {
            router.refresh();
          }
        }
      )
      .subscribe();

    const interval = setInterval(() => router.refresh(), 20_000);

    return () => {
      clearInterval(interval);
      void supabase.removeChannel(channel);
    };
  }, [router]);

  return null;
}
