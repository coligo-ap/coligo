"use client";

import { useEffect } from "react";
import { createClient } from "@/lib/supabase/client";

type OrderRow = {
  id: string;
  status: string;
  customer_name: string | null;
  total_da: number | null;
  created_at: string;
  merchant_id: string;
};

type Handlers = {
  onInsert?: (order: OrderRow) => void;
  onUpdate?: (order: OrderRow) => void;
};

/**
 * S'abonne aux events Realtime de la table `orders` pour un commerçant donné.
 * La RLS Supabase est appliquée aux events → on ne reçoit que SES commandes.
 *
 * Le canal est recréé si `merchantId` change ; le clean-up garantit qu'on ne
 * laisse pas de subscription pendante (memory leak / Realtime quota).
 */
export function useOrderRealtime(
  merchantId: string | null,
  handlers: Handlers
) {
  useEffect(() => {
    if (!merchantId) return;
    const supabase = createClient();
    const channel = supabase
      .channel(`orders-bridge:${merchantId}`)
      .on(
        "postgres_changes",
        {
          event: "INSERT",
          schema: "public",
          table: "orders",
          filter: `merchant_id=eq.${merchantId}`,
        },
        (payload) => handlers.onInsert?.(payload.new as OrderRow)
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "orders",
          filter: `merchant_id=eq.${merchantId}`,
        },
        (payload) => handlers.onUpdate?.(payload.new as OrderRow)
      )
      .subscribe();

    return () => {
      void supabase.removeChannel(channel);
    };
    // handlers est ref-stable côté appelant (useCallback), pas besoin de l'inclure
    // dans les deps pour éviter de re-souscrire à chaque rerender.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [merchantId]);
}
