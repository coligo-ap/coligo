"use client";

// =============================================================================
// Suivi des messages non lus d'une course (client ↔ chauffeur).
// =============================================================================
// Interroge les messages au niveau de l'écran (même chat fermé) pour :
//   - afficher un compteur de non-lus sur le bouton « Messages » ;
//   - déclencher une notification in-app quand un nouveau message arrive.
// Le « vu » est mémorisé par course (localStorage) : à l'ouverture du chat, tout
// est marqué lu.
// =============================================================================

import { useCallback, useEffect, useRef, useState } from "react";

export type ChatMsg = {
  id: string;
  sender: string;
  body: string;
  created_at: string;
};

const seenKey = (rideId: string) => `coligo-ride-seen-${rideId}`;

export function useUnreadRideMessages(
  rideId: string | null,
  /** Camp dont les messages comptent comme « reçus » par l'utilisateur courant. */
  otherSender: "customer" | "chauffeur",
  fetcher: (rideId: string) => Promise<ChatMsg[]>,
  active: boolean,
  /** Marque les messages reçus (read=false) — appelé après chaque poll. */
  markDelivered?: (rideId: string, read: boolean) => void
) {
  const [msgs, setMsgs] = useState<ChatMsg[]>([]);
  const [seenTick, setSeenTick] = useState(0);
  const seenRef = useRef(0);

  useEffect(() => {
    if (!rideId) return;
    const raw =
      typeof window !== "undefined"
        ? window.localStorage.getItem(seenKey(rideId))
        : null;
    seenRef.current = raw ? Number(raw) : 0;
    setSeenTick((t) => t + 1);
  }, [rideId]);

  const poll = useCallback(async () => {
    if (!rideId) return;
    const m = await fetcher(rideId);
    setMsgs(m);
    // Accusé « reçu » : un message du camp opposé existe et l'app est ouverte.
    if (markDelivered && m.some((x) => x.sender === otherSender))
      markDelivered(rideId, false);
  }, [rideId, fetcher, markDelivered, otherSender]);

  useEffect(() => {
    if (!rideId || !active) return;
    void poll();
    const id = setInterval(poll, 4000);
    return () => clearInterval(id);
  }, [rideId, active, poll]);

  const markSeen = useCallback(() => {
    const now = Date.now();
    seenRef.current = now;
    if (rideId && typeof window !== "undefined")
      window.localStorage.setItem(seenKey(rideId), String(now));
    setSeenTick((t) => t + 1);
  }, [rideId]);

  // Recalcule à chaque arrivée de messages OU marquage lu (seenTick).
  void seenTick;
  const incoming = msgs.filter(
    (m) =>
      m.sender === otherSender &&
      new Date(m.created_at).getTime() > seenRef.current
  );
  const unread = incoming.length;
  const lastIncoming = incoming.length ? incoming[incoming.length - 1] : null;

  return { unread, lastIncoming, markSeen, refresh: poll };
}
