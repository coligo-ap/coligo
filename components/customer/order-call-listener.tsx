"use client";

import { useOrderCall } from "@/lib/call/use-inapp-call";

/**
 * Écouteur d'appel COMMANDE côté CLIENT (monté sur le suivi de commande) :
 * si le commerçant appelle via l'app, l'écran d'appel entrant s'affiche
 * (accepter / refuser). Le client ne peut PAS initier d'appel par ce canal
 * (sens unique commerçant → client) — ce composant ne rend que les overlays.
 *
 * App fermée : la push FCM APPEL (sonnerie plein écran native Android) ouvre
 * cette page ; l'invitation ré-émise pendant 30 s affiche l'appel entrant.
 */
export function OrderCallListener({
  orderId,
  merchantName,
}: {
  orderId: string;
  merchantName: string;
}) {
  const call = useOrderCall({
    orderId,
    role: "client",
    peerName: merchantName,
  });
  return <>{call.ui}</>;
}
