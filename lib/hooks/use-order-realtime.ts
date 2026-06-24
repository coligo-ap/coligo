"use client";

import { useEffect, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { usePageVisible } from "@/lib/realtime/use-page-visible";

type OrderRow = {
  id: string;
  status: string;
  customer_name: string | null;
  total_da: number | null;
  created_at: string;
  merchant_id: string;
  // Présents dans le payload Realtime (ligne complète) — servent à ne PAS
  // alerter le commerçant pour une commande online pas encore payée.
  order_number?: string | null;
  payment_method?: string | null;
  payment_status?: string | null;
};

type Handlers = {
  onInsert?: (order: OrderRow) => void;
  onUpdate?: (order: OrderRow) => void;
};

export type RealtimeStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";

/**
 * S'abonne aux events Realtime de la table `orders` pour un commerçant donné.
 * La RLS Supabase est appliquée aux events → on ne reçoit que SES commandes.
 *
 * Retourne le `status` du canal pour qu'on puisse afficher un indicateur
 * visible (point vert / rouge) côté commerçant et logger en console — sans
 * indicateur, un canal qui n'a jamais réussi à se connecter (auth invalide,
 * websocket bloqué) reste silencieux et le commerçant ne voit aucune nouvelle
 * commande sans rafraîchir manuellement.
 *
 * Le canal est recréé si `merchantId` change ; le clean-up garantit qu'on ne
 * laisse pas de subscription pendante (memory leak / Realtime quota).
 */
export function useOrderRealtime(
  merchantId: string | null,
  handlers: Handlers
): RealtimeStatus {
  const [status, setStatus] = useState<RealtimeStatus>("idle");
  // Hygiène connexions (quota Realtime Free PARTAGÉ entre tous les rôles) : on
  // n'ouvre le canal QUE quand le board est au premier plan. En arrière-plan, le
  // FCM (nouvelle commande) + le poll de secours du bridge couvrent ; on rend la
  // connexion au pool. Réouverture automatique au retour au premier plan.
  const visible = usePageVisible();

  useEffect(() => {
    if (!merchantId || !visible) return;
    setStatus("connecting");
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
        (payload) => {
          if (process.env.NODE_ENV !== "production") {
            console.info("[realtime] INSERT", payload.new);
          }
          handlers.onInsert?.(payload.new as OrderRow);
        }
      )
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "orders",
          filter: `merchant_id=eq.${merchantId}`,
        },
        (payload) => {
          if (process.env.NODE_ENV !== "production") {
            console.info("[realtime] UPDATE", payload.new);
          }
          handlers.onUpdate?.(payload.new as OrderRow);
        }
      )
      .subscribe((s, err) => {
        // Le SDK Supabase renvoie : SUBSCRIBED | TIMED_OUT | CHANNEL_ERROR | CLOSED.
        if (process.env.NODE_ENV !== "production") {
          console.info("[realtime] status", s, err ?? "");
        }
        if (s === "SUBSCRIBED") setStatus("connected");
        else if (s === "TIMED_OUT" || s === "CHANNEL_ERROR") setStatus("error");
        else if (s === "CLOSED") setStatus("disconnected");
      });

    return () => {
      void supabase.removeChannel(channel);
      setStatus("idle");
    };
    // handlers est ref-stable côté appelant (useCallback), pas besoin de l'inclure
    // dans les deps pour éviter de re-souscrire à chaque rerender.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [merchantId, visible]);

  return status;
}
