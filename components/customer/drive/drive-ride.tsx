"use client";

import { useEffect, useRef, useState } from "react";
import { Loader2 } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { useResumeResync } from "@/lib/hooks/use-resume-resync";
import {
  getDriveLastRide,
  getRideCardState,
  type DriveActiveRide,
  type DriveContext,
  type DriveLastRide,
} from "@/app/(customer)/drive/actions";
import { VIOLET } from "./drive-modals";
import { SearchScreen } from "./drive-ride-search";
import { EnrouteScreen } from "./drive-ride-enroute";
import { DoneScreen, CancelledScreen } from "./drive-ride-done";

/**
 * Drive client — phase course : offres des chauffeurs (triables, favoris en
 * tête), suivi temps réel (fiche chauffeur v3, partage, SOS, itinéraire
 * anormal), fin de course (récap, cashback, notation, signalement).
 */

export function DriveRide({
  ctx,
  active,
  offlineQueued,
  refreshActive,
  onExit,
  onBackToPrice,
  onCardFailed,
}: {
  ctx: DriveContext;
  active: DriveActiveRide | null;
  offlineQueued: boolean;
  refreshActive: () => Promise<DriveActiveRide | null>;
  onExit: () => void;
  onBackToPrice: () => void;
  /** Paiement carte échoué (webhook) : retour au choix de gamme, message inline. */
  onCardFailed: () => void;
}) {
  const [done, setDone] = useState<DriveLastRide>(null);
  const [cancelled, setCancelled] = useState<{
    reason: string | null;
    mine: boolean;
    refunded: boolean;
  } | null>(null);
  const lastStatus = useRef<string | null>(active?.status ?? null);

  // Une course « en course » = assignée à un chauffeur (accepted → in_progress),
  // ni recherche ni terminée/annulée.
  const isProgressed = (s?: string | null) =>
    !!s && s !== "searching" && s !== "completed" && s !== "cancelled";
  // Garde ANTI-FLASH : une fois un chauffeur assigné, si la course « disparaît »
  // (my_active_ride → null quand elle passe terminée), on NE DOIT PAS retomber
  // sur l'écran des propositions. On mémorise qu'on a dépassé la recherche → au
  // rendu on TIENT l'écran (bref spinner) le temps que « terminée / annulée » se
  // pose (instantané via le Realtime), au lieu de flasher les propositions.
  const progressedRef = useRef(isProgressed(active?.status));
  if (isProgressed(active?.status)) progressedRef.current = true;

  // Carte en attente de paiement : id de la course à surveiller (échec
  // Chargily → le webhook annule la demande, on revient au choix de gamme).
  const waitingCardRef = useRef<string | null>(null);
  if (active) {
    // Conservée quand `active` devient null : l'annulation webhook fait
    // disparaître la course AVANT que l'échec carte soit détecté ici.
    waitingCardRef.current =
      active.payment_method === "card" && !active.online_paid
        ? active.id
        : null;
  }

  // RETOUR D'ARRIÈRE-PLAN : à la reprise (déverrouillage, retour d'une autre app,
  // onglet réactivé, réseau revenu), on bumpe ce compteur → les effets de
  // synchro/Realtime ci-dessous se relancent IMMÉDIATEMENT (poll + ré-abonnement
  // au Realtime, qui a pu tomber en arrière-plan). Ainsi, si un chauffeur a
  // accepté / la course a changé pendant l'absence, l'écran le reflète AUSSITÔT
  // au lieu d'attendre le prochain tick throttlé, et l'action suivante (annuler…)
  // part d'un état frais sur une connexion réveillée.
  const [resyncNonce, setResyncNonce] = useState(0);
  useResumeResync(() => setResyncNonce((n) => n + 1));

  // SYNCHRONISATION UNIQUE de la course + détection de transition (terminée /
  // annulée / échec carte). Un SEUL point de vérité, appelé À LA FOIS par le
  // Realtime (instantané, façon Bolt) ET par le poll de rattrapage. AVANT, le
  // Realtime appelait refreshActive() « nu » : dès que le chauffeur terminait,
  // `active` passait à null et le rendu FLASHAIT l'écran des propositions — le
  // setDone n'arrivait qu'au poll suivant (jusqu'à 20 s après). Maintenant la
  // détection se fait au même endroit → bascule « Course terminée » immédiate.
  const syncRide = async (): Promise<void> => {
    // Échec du paiement carte (webhook seul fait foi, mig 0163) : retour direct
    // au choix de gamme — PAS l'écran « course annulée ».
    if (waitingCardRef.current) {
      const st = await getRideCardState(waitingCardRef.current);
      if (st?.failed) {
        onCardFailed();
        return;
      }
    }
    const ride = await refreshActive();
    if (ride) {
      lastStatus.current = ride.status;
      if (isProgressed(ride.status)) progressedRef.current = true;
      return;
    }
    // Course DISPARUE (plus active) : elle vient d'être terminée ou annulée.
    if (!lastStatus.current) return;
    const last = await getDriveLastRide();
    if (last?.status === "completed") setDone(last);
    else if (waitingCardRef.current) {
      // Disparue pendant l'attente carte = annulée pour échec de paiement →
      // choix de gamme, pas l'écran « course annulée ».
      onCardFailed();
      return;
    } else if (last)
      setCancelled({
        reason: null,
        mine: false,
        refunded: last.payment_method !== "cash",
      });
    else {
      // Course disparue sans trace terminée/annulée récente (cas limite) : on ne
      // reste pas bloqué sur le spinner — retour propre à l'accueil Drive.
      onExit();
      return;
    }
    lastStatus.current = null;
  };
  // Ref « toujours à jour » : les effets appellent syncRef.current(), donc le
  // Realtime NE se ré-abonne PAS à chaque changement de callback inline du parent
  // (aucun churn de canal — cf. piège topic Realtime dupliqué).
  const syncRef = useRef(syncRide);
  syncRef.current = syncRide;

  // Poll = FILET LENT (20 s) : la sync course est INSTANTANÉE via le Realtime
  // ci-dessous (postgres_changes sur `rides`). On ne martèle pas le serveur.
  useEffect(() => {
    let stop = false;
    const tick = () => {
      if (!stop) void syncRef.current();
    };
    const id = setInterval(tick, 20000);
    tick();
    return () => {
      stop = true;
      clearInterval(id);
    };
    // resyncNonce : un retour d'arrière-plan relance un tick immédiat.
     
  }, [resyncNonce]);

  // Temps réel : tout changement de la course (acceptation, statut, prix
  // convenu, FIN) déclenche la MÊME sync → détection « terminée / annulée »
  // instantanée (plus seulement un refresh).
  const activeId = active?.id ?? null;
  useEffect(() => {
    if (!activeId) return;
    const supabase = createClient();
    const ch = supabase
      .channel(`ride-${activeId}`)
      .on(
        "postgres_changes",
        {
          event: "UPDATE",
          schema: "public",
          table: "rides",
          filter: `id=eq.${activeId}`,
        },
        () => void syncRef.current()
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
    // resyncNonce : ré-abonnement au retour d'arrière-plan (le canal a pu tomber).
     
  }, [activeId, resyncNonce]);

  if (done) return <DoneScreen ride={done} onExit={onExit} />;
  if (cancelled)
    return (
      <CancelledScreen
        reason={cancelled.reason}
        mine={cancelled.mine}
        refunded={cancelled.refunded}
        onExit={onExit}
      />
    );
  if (active && isProgressed(active.status))
    return (
      <EnrouteScreen
        ctx={ctx}
        ride={active}
        onCancelled={(reason) =>
          setCancelled({
            reason,
            mine: true,
            refunded: (active?.payment_method ?? "cash") !== "cash",
          })
        }
      />
    );
  // `active` null ou « searching ».
  if (progressedRef.current) {
    // Course assignée puis disparue (terminée/annulée) : la détection est EN VOL
    // → on tient l'écran (bref spinner) plutôt que de flasher les propositions.
    // syncRide pose done/cancelled juste après (instantané via le Realtime).
    return <FinishingHold />;
  }
  return (
    <SearchScreen
      ctx={ctx}
      ride={active}
      offlineQueued={offlineQueued}
      refreshActive={refreshActive}
      onBackToPrice={onBackToPrice}
    />
  );
}

/** Transition brève « la course se termine » — évite tout flash de l'écran des
 *  propositions entre la disparition de la course active et la bascule sur
 *  « Course terminée / annulée » (posée juste après par syncRide). */
function FinishingHold() {
  return (
    <div className="grid min-h-[70vh] place-items-center px-6">
      <Loader2 className="size-7 animate-spin" style={{ color: VIOLET }} />
    </div>
  );
}

/* ════════════════ OFFRES DES CHAUFFEURS (triables) ════════════════ */
