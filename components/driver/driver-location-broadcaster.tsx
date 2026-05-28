"use client";

import { useEffect, useRef } from "react";
import { watchPosition } from "@/lib/native/geolocation";
import { createClient } from "@/lib/supabase/client";

/**
 * Diffuse en continu la position GPS du livreur pour la commande en cours,
 * pour que le client la suive en direct (façon UberEats/Yassir).
 *
 * - Aucune UI (retourne null).
 * - Throttle : 1 envoi toutes ~12 s max (on ne spamme pas la DB).
 * - Appelle le RPC `update_driver_live_location` directement via le client
 *   Supabase (le RPC est SECURITY DEFINER et vérifie l'attribution). Pas de
 *   server action : on évite un aller-retour Next à chaque ping.
 * - Se coupe automatiquement au démontage (fin de livraison / navigation).
 */
const MIN_INTERVAL_MS = 12_000;

export function DriverLocationBroadcaster({ orderId }: { orderId: string }) {
  const lastSentRef = useRef(0);
  const sendingRef = useRef(false);

  useEffect(() => {
    if (!orderId) return;
    const supabase = createClient();

    const push = async (lat: number, lng: number) => {
      const now = Date.now();
      if (sendingRef.current) return;
      if (now - lastSentRef.current < MIN_INTERVAL_MS) return;
      sendingRef.current = true;
      lastSentRef.current = now;
      try {
        await supabase.rpc("update_driver_live_location", {
          p_order_id: orderId,
          p_lat: lat,
          p_lng: lng,
        });
      } catch {
        // Réseau coupé : on réessaiera à la prochaine position GPS.
      } finally {
        sendingRef.current = false;
      }
    };

    const handle = watchPosition(
      (c) => void push(c.latitude, c.longitude),
      () => {},
      { enableHighAccuracy: true, maximumAge: 8_000 }
    );

    return () => handle?.stop();
  }, [orderId]);

  return null;
}
