"use client";

import { useEffect, useRef } from "react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";

// =============================================================================
// useBroadcastBump — abonnement broadcast à un topic SERVEUR (clé FIXE, ex.
// `shared-cart:{token}` : le `send` REST cible ce topic exact, impossible d'y
// suffixer un nonce d'instance). PIÈGE du client singleton
// (reference_realtime_channel_topic_collision) : realtime-js déduplique les
// canaux PAR TOPIC et `removeChannel` est ASYNCHRONE — pendant qu'un ancien
// canal se désinscrit (reprise d'arrière-plan via resyncNonce, navigation
// room ⇄ /payer sur le même topic), `channel(topic)` renvoie ce canal mourant
// et `subscribe()` est un no-op silencieux → plus AUCUN bump reçu jusqu'au
// remontage. On purge donc (en ATTENDANT la désinscription) tout canal
// résiduel du topic avant d'en créer un frais.
// =============================================================================

export function useBroadcastBump(
  topic: string | null,
  event: string,
  onBump: () => void,
  resyncNonce = 0
): void {
  // Callback dans une ref : sa nouvelle identité à chaque render ne doit pas
  // re-déclencher l'abonnement (sinon on recrée le canal en boucle).
  const cb = useRef(onBump);
  cb.current = onBump;

  useEffect(() => {
    if (!topic) return;
    const supabase = createClient();
    let disposed = false;
    let channel: RealtimeChannel | null = null;
    void (async () => {
      // Purge des canaux résiduels du MÊME topic (socket mort ⇒ le leave
      // résout immédiatement ; socket vivant ⇒ on attend l'ack d'éviction).
      const realtimeTopic = `realtime:${topic}`;
      const stale = supabase
        .getChannels()
        .filter((c) => c.topic === topic || c.topic === realtimeTopic);
      await Promise.all(stale.map((c) => supabase.removeChannel(c)));
      if (disposed) return;
      channel = supabase
        .channel(topic)
        .on("broadcast", { event }, () => cb.current())
        .subscribe();
    })();
    return () => {
      disposed = true;
      if (channel) void supabase.removeChannel(channel);
    };
  }, [topic, event, resyncNonce]);
}
