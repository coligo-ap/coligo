"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { useDriverPosition } from "@/lib/native/use-driver-position";
import { driverHeartbeat, pullNextExpressNearby } from "@/app/(driver)/actions";
import { useWorkZone, LIVE_RADIUS_KM } from "@/lib/driver/work-zone";
import { playNewOrder } from "@/lib/driver/sounds";
import { vibrate } from "@/lib/hooks/use-alert-sound";
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
  // Zone de travail choisie : si définie, le dispatch interroge son CENTRE +
  // RAYON (où que soit le livreur, GPS facultatif) ; sinon on suit le GPS live.
  const zone = useWorkZone();
  const zoneRef = useRef(zone);
  zoneRef.current = zone;
  const busy = useRef(false);
  const tickRef = useRef<() => void>(() => {});

  useEffect(() => {
    if (!online) return;
    let alive = true;

    const tick = async () => {
      // Origine du dispatch : la zone choisie en priorité, sinon le GPS live.
      const z = zoneRef.current;
      const c = coordsRef.current;
      const origin = z
        ? { lat: z.lat, lng: z.lng, radiusKm: z.radiusKm }
        : c
          ? { lat: c.latitude, lng: c.longitude, radiusKm: LIVE_RADIUS_KM }
          : null;
      if (!alive || busy.current || !origin) return;
      busy.current = true;
      // Heartbeat de présence (best-effort) : pousse l'origine (zone ou GPS)
      // pour que les push « nouvelle course » ciblent ce périmètre (mig 0130).
      void driverHeartbeat(origin.lat, origin.lng);
      try {
        const r = await pullNextExpressNearby(
          origin.lat,
          origin.lng,
          origin.radiusKm
        );
        if (alive && r.orderId) {
          // Réception GLOBALE (n'importe quelle page) : il faut SONNER, pas juste
          // un toast — sinon le livreur, app en poche, rate la course. Son gaté
          // par la préférence « Sons » ; vibration en complément.
          void playNewOrder();
          vibrate([0, 120, 60, 120]);
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

  // Changement de zone (ou GPS dispo après coup) → tente un pull immédiat dans
  // le nouveau périmètre, sans attendre le prochain cycle de polling.
  useEffect(() => {
    if (online) tickRef.current();
  }, [online, zone, coords]);

  return null;
}
