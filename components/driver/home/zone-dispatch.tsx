"use client";

import { useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { useLocale } from "next-intl";
import { createClient } from "@/lib/supabase/client";
import { useDriverPosition } from "@/lib/native/use-driver-position";
import { driverHeartbeat, pullNextExpressNearby } from "@/app/(driver)/actions";
import { useWorkZone, LIVE_RADIUS_KM } from "@/lib/driver/work-zone";
import { setDispatchActive } from "@/lib/realtime/dispatch-presence";
import { ensureRealtimeAuth } from "@/lib/realtime/ensure-auth";
import { playNewOrder } from "@/lib/driver/sounds";
import { vibrate } from "@/lib/hooks/use-alert-sound";
import { toast } from "@/components/ui/toast";
import { bumpIncoming } from "@/lib/driver/incoming-store";

/**
 * Dispatch par ZONE (réception Express GLOBALE). Quand le livreur est EN LIGNE,
 * tente d'attribuer une commande express d'un commerçant proche (RPC
 * géographique pull_next_express_nearby) — SANS aucune inscription chez le
 * commerçant. À l'attribution, on route vers /driver/course/[orderId] (course
 * autonome) : le flux éprouvé (offre qui sonne → course → validation) prend le
 * relais. Monté globalement dans le layout livreur → la réception fonctionne
 * sur n'importe quelle page tant qu'il est en ligne.
 *
 * Déclencheurs : DISPATCH PUSH CIBLÉ (le serveur pousse `new_express` sur le
 * canal perso `courier:{userId}` aux livreurs proches — plus d'abonnement GLOBAL
 * aux commandes, qui réveillait TOUS les livreurs à chaque commande = O(cmd ×
 * livreurs)) + repli polling 20 s (le timing intelligent rend une commande
 * attribuable à son prep_notif_at, sans évènement à cet instant précis). La RPC
 * est idempotente et ne fait rien si le livreur a déjà une course → poll sûr.
 */
export function ZoneDispatch({
  online,
  userId,
}: {
  online: boolean;
  userId: string | null;
}) {
  const coords = useDriverPosition();
  const router = useRouter();
  const isAr = useLocale() === "ar";
  const isArRef = useRef(isAr);
  isArRef.current = isAr;
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
    // Dispatch in-app actif → le push FCM web ne doublera pas la notif (dédup).
    setDispatchActive("courier", true);
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
          toast.success(
            isArRef.current
              ? "توصيلة جديدة بالقرب منك ⚡"
              : "Nouvelle course à proximité ⚡"
          );
          // ULTRA RAPIDE : l'attribution vient de réussir → on prévient
          // l'accordéon de recharger DANS LE MÊME TICK (sans attendre le
          // Realtime ni le polling). La carte apparaît instantanément.
          bumpIncoming();
          // On ramène le livreur sur l'ACCUEIL : la demande y apparaît en carte
          // dépliable (IncomingRequests, façon UberEats). Il déplie, appelle,
          // accepte (→ course) ou refuse. Sur l'accueil, le realtime l'affiche
          // sans même naviguer.
          router.push("/driver");
        }
      } finally {
        busy.current = false;
      }
    };
    tickRef.current = tick;

    void tick();
    // Fast-path = DISPATCH PUSH (sous-seconde). Le poll n'est qu'un FILET si le
    // broadcast est raté : resserré à 12 s pour une réception « ultra rapide »
    // même hors ligne temps réel.
    const poll = setInterval(tick, 12_000);

    // DISPATCH PUSH CIBLÉ : on n'écoute plus TOUTES les commandes express. Le
    // serveur (notifyDriversNewExpress) pousse `new_express` aux livreurs proches
    // sur leur canal perso → on tente alors un pull. Le poll 20 s reste le FILET
    // FIABLE (réception garantie même broadcast raté). Tant que le user_id n'est
    // pas connu, seul le poll tourne.
    const supabase = createClient();
    let channel: ReturnType<typeof supabase.channel> | null = null;
    if (userId) {
      void (async () => {
        // JWT garanti sur le socket AVANT le canal PRIVÉ (sinon CHANNEL_ERROR
        // → broadcast jamais reçu ; seul le poll fonctionnerait).
        await ensureRealtimeAuth(supabase);
        if (!alive) return;
        channel = supabase
          .channel(`courier:${userId}`, { config: { private: true } })
          .on(
            "broadcast",
            { event: "new_express" },
            () => void tickRef.current()
          )
          .subscribe();
      })();
    }

    return () => {
      setDispatchActive("courier", false);
      alive = false;
      clearInterval(poll);
      if (channel) void supabase.removeChannel(channel);
    };
  }, [online, userId, router]);

  // Changement de zone (ou GPS dispo après coup) → tente un pull immédiat dans
  // le nouveau périmètre, sans attendre le prochain cycle de polling.
  useEffect(() => {
    if (online) tickRef.current();
  }, [online, zone, coords]);

  return null;
}
