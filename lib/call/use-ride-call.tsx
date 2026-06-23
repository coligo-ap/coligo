"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { Phone, PhoneOff, Loader2, Video } from "lucide-react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import { createClient } from "@/lib/supabase/client";
import { Portal } from "@/components/ui/portal";
import { toast } from "@/components/ui/toast";
import { CallOverlay } from "@/components/call/call-overlay";

// =============================================================================
// useRideCall — appels in-app client ↔ chauffeur (Coligo Drive), numéros
// masqués (rien ne passe par le téléphone — tout en data via Agora).
//
// SIGNALING « sonnerie » : Supabase Realtime BROADCAST sur un canal SCOPÉ à la
// course (`ride-call-<rideId>`). C'est éphémère (aucune écriture DB) et les deux
// parties sont déjà sur l'écran de course → coût Supabase quasi nul. (La
// sonnerie quand l'app est en arrière-plan via FCM est une étape suivante.)
//
// Le hook gère tout le cycle (appel sortant → sonnerie → accepté → en cours →
// raccroché) et renvoie `ui` (les overlays à monter) + `start()` pour déclencher
// un appel. L'écran hôte fournit son propre bouton.
// =============================================================================

type Phase = "idle" | "outgoing" | "incoming" | "active";

type Evt =
  | { event: "invite"; payload: { fromRole: string; video: boolean } }
  | { event: "accept"; payload: { fromRole: string } }
  | { event: "decline"; payload: { fromRole: string } }
  | { event: "bye"; payload: { fromRole: string } };

export function useRideCall({
  rideId,
  role,
  peerName,
}: {
  rideId: string;
  role: "client" | "chauffeur";
  peerName: string;
}) {
  const [phase, setPhase] = useState<Phase>("idle");
  const [withVideo, setWithVideo] = useState(false);
  const chanRef = useRef<RealtimeChannel | null>(null);
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const send = useCallback(
    (event: Evt["event"], payload: Record<string, unknown> = {}) => {
      chanRef.current?.send({
        type: "broadcast",
        event,
        payload: { fromRole: role, ...payload },
      });
    },
    [role]
  );

  const clearTimer = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
  };

  // Abonnement au canal de la course (réception des invitations + réponses).
  useEffect(() => {
    if (!rideId) return;
    const supabase = createClient();
    const ch = supabase.channel(`ride-call-${rideId}`, {
      config: { broadcast: { self: false } },
    });
    ch.on("broadcast", { event: "invite" }, ({ payload }) => {
      setPhase((p) => {
        if (p !== "idle") return p; // déjà en ligne / en appel
        setWithVideo(!!(payload as { video?: boolean }).video);
        return "incoming";
      });
    })
      .on("broadcast", { event: "accept" }, () => {
        setPhase((p) => {
          if (p !== "outgoing") return p;
          clearTimer();
          return "active";
        });
      })
      .on("broadcast", { event: "decline" }, () => {
        setPhase((p) => {
          if (p !== "outgoing") return p;
          clearTimer();
          toast.info?.(`${peerName} a refusé l'appel`);
          return "idle";
        });
      })
      .on("broadcast", { event: "bye" }, () => {
        setPhase((p) => (p === "active" || p === "incoming" ? "idle" : p));
      })
      .subscribe();
    chanRef.current = ch;
    return () => {
      clearTimer();
      void supabase.removeChannel(ch);
      chanRef.current = null;
    };
  }, [rideId, peerName]);

  // ─── Démarrer un appel sortant ───
  const start = useCallback(
    (video = false) => {
      setPhase((p) => {
        if (p !== "idle") return p;
        setWithVideo(video);
        send("invite", { video });
        // Sans réponse en 30 s → on abandonne.
        clearTimer();
        timeoutRef.current = setTimeout(() => {
          setPhase((cur) => {
            if (cur !== "outgoing") return cur;
            send("bye");
            toast.info?.("Pas de réponse");
            return "idle";
          });
        }, 30_000);
        return "outgoing";
      });
    },
    [send]
  );

  const accept = useCallback(() => {
    send("accept");
    setPhase("active");
  }, [send]);

  const decline = useCallback(() => {
    send("decline");
    setPhase("idle");
  }, [send]);

  const cancelOutgoing = useCallback(() => {
    clearTimer();
    send("bye");
    setPhase("idle");
  }, [send]);

  const endActive = useCallback(() => {
    send("bye");
    setPhase("idle");
  }, [send]);

  // ─── UI (overlays) ───
  let ui: React.ReactNode = null;
  if (phase === "active") {
    ui = (
      <CallOverlay
        rideId={rideId}
        role={role}
        peerName={peerName}
        startWithVideo={withVideo}
        onEnd={endActive}
      />
    );
  } else if (phase === "outgoing") {
    ui = (
      <RingScreen
        peerName={peerName}
        sub="Appel en cours…"
        onHangup={cancelOutgoing}
      />
    );
  } else if (phase === "incoming") {
    ui = (
      <IncomingScreen
        peerName={peerName}
        video={withVideo}
        onAccept={accept}
        onDecline={decline}
      />
    );
  }

  return { start, ui, busy: phase !== "idle" };
}

/* ─── Écran « appel en cours… » (sortant, en attente de réponse) ─── */
function RingScreen({
  peerName,
  sub,
  onHangup,
}: {
  peerName: string;
  sub: string;
  onHangup: () => void;
}) {
  return (
    <Portal>
      <div className="fixed inset-0 z-[200] flex flex-col items-center bg-[#0d0b18] text-white">
        <div className="mt-[22vh] grid size-24 place-items-center rounded-full bg-white/10 text-4xl font-black">
          {peerName.charAt(0).toUpperCase()}
        </div>
        <p className="mt-4 text-xl font-extrabold">{peerName}</p>
        <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-white/70">
          <Loader2 className="size-3.5 animate-spin" />
          {sub}
        </p>
        <button
          type="button"
          onClick={onHangup}
          aria-label="Annuler"
          className="mt-auto mb-[max(2.5rem,env(safe-area-inset-bottom))] grid size-16 place-items-center rounded-full bg-red-600 shadow-lg active:scale-95"
        >
          <PhoneOff className="size-7" />
        </button>
      </div>
    </Portal>
  );
}

/* ─── Écran « appel entrant » (accepter / refuser) ─── */
function IncomingScreen({
  peerName,
  video,
  onAccept,
  onDecline,
}: {
  peerName: string;
  video: boolean;
  onAccept: () => void;
  onDecline: () => void;
}) {
  return (
    <Portal>
      <div className="fixed inset-0 z-[200] flex flex-col items-center bg-[#0d0b18] text-white">
        <div className="mt-[20vh] grid size-24 place-items-center rounded-full bg-white/10 text-4xl font-black">
          {peerName.charAt(0).toUpperCase()}
        </div>
        <p className="mt-4 text-xl font-extrabold">{peerName}</p>
        <p className="mt-1 flex items-center gap-1.5 text-sm font-semibold text-white/70">
          {video ? (
            <Video className="size-3.5" />
          ) : (
            <Phone className="size-3.5" />
          )}
          {video ? "Appel vidéo entrant…" : "Appel entrant…"}
        </p>
        <div className="mt-auto mb-[max(2.5rem,env(safe-area-inset-bottom))] flex items-center gap-16">
          <button
            type="button"
            onClick={onDecline}
            aria-label="Refuser"
            className="grid size-16 place-items-center rounded-full bg-red-600 shadow-lg active:scale-95"
          >
            <PhoneOff className="size-7" />
          </button>
          <button
            type="button"
            onClick={onAccept}
            aria-label="Accepter"
            className="grid size-16 place-items-center rounded-full bg-green-600 shadow-lg active:scale-95"
          >
            <Phone className="size-7" />
          </button>
        </div>
      </div>
    </Portal>
  );
}
