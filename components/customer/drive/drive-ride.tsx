"use client";

import { useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import { useResumeResync } from "@/lib/hooks/use-resume-resync";
import {
  getDriveLastRide,
  getRideCardState,
  type DriveActiveRide,
  type DriveContext,
  type DriveLastRide,
} from "@/app/(customer)/drive/actions";
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

  // Poll de la course active + détection de transition (terminée / annulée).
  useEffect(() => {
    let stop = false;
    const tick = async () => {
      // Échec du paiement carte (webhook seul fait foi, mig 0163) : retour
      // direct à l'écran de choix de gamme — PAS l'écran « course annulée ».
      if (waitingCardRef.current) {
        const st = await getRideCardState(waitingCardRef.current);
        if (stop) return;
        if (st?.failed) {
          onCardFailed();
          return;
        }
      }
      const ride = await refreshActive();
      if (stop) return;
      if (!ride && lastStatus.current && !cancelled) {
        const last = await getDriveLastRide();
        if (stop) return;
        if (last?.status === "completed") setDone(last);
        else if (waitingCardRef.current) {
          // Disparue pendant l'attente carte = annulée pour échec de
          // paiement → choix de gamme, pas l'écran « course annulée ».
          onCardFailed();
          return;
        } else if (last)
          setCancelled({
            reason: null,
            mine: false,
            refunded: last.payment_method !== "cash",
          });
        lastStatus.current = null;
        return;
      }
      if (ride) lastStatus.current = ride.status;
    };
    // Poll = FILET LENT seulement : la sync course (statut/terminée/annulée) est
    // INSTANTANÉE via le Realtime ci-dessous (postgres_changes sur `rides`). On
    // ne martèle PAS le serveur — façon Uber/Google : push DB temps réel + poll
    // de rattrapage uniquement (avant : 4 s → 20 s). Cas spécial paiement carte
    // (webhook) : le filet 20 s suffit le temps de la confirmation.
    const id = setInterval(tick, 20000);
    void tick();
    return () => {
      stop = true;
      clearInterval(id);
    };
    // resyncNonce : un retour d'arrière-plan relance un tick immédiat.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [refreshActive, resyncNonce]);

  // Temps réel : tout changement de la course (acceptation, statut, prix
  // convenu) rafraîchit instantanément — le poll 4 s reste en filet.
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
        () => void refreshActive()
      )
      .subscribe();
    return () => {
      void supabase.removeChannel(ch);
    };
    // resyncNonce : ré-abonnement au retour d'arrière-plan (le canal a pu tomber).
  }, [activeId, refreshActive, resyncNonce]);

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
  if (!active || active.status === "searching")
    return (
      <SearchScreen
        ctx={ctx}
        ride={active}
        offlineQueued={offlineQueued}
        refreshActive={refreshActive}
        onBackToPrice={onBackToPrice}
      />
    );
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
}

/* ════════════════ OFFRES DES CHAUFFEURS (triables) ════════════════ */
