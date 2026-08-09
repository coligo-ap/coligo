"use client";

import { useEffect, useRef } from "react";
import { useLocationGate, gateBlocks } from "@/lib/hooks/use-location-gate";
import { LocationRequiredScreen } from "@/components/shared/location-required-screen";
import { setChauffeurOnlineLocal } from "@/lib/chauffeur/online-store";
import { chauffeurLogout, setChauffeurOnline } from "@/app/(chauffeur)/actions";

/**
 * Garde de LOCALISATION de l'espace chauffeur — montée dans la coque `(app)`,
 * donc active sur TOUS les onglets authentifiés.
 *
 * Sans position exacte, le chauffeur ne peut pas travailler : l'écran bloquant
 * recouvre l'app ET il est mis HORS LIGNE (localement et côté serveur) → il
 * disparaît du dispatch, ne reçoit plus ni demande ni push. Sa SESSION reste
 * ouverte : s'il a une course en cours, il pourra la terminer dès qu'il aura
 * réactivé sa localisation, au lieu de se retrouver à l'écran de connexion avec
 * un passager à bord.
 *
 * La mise hors ligne n'est envoyée qu'UNE fois par épisode de blocage (le
 * statut peut être réévalué toutes les 15 s) — et on réarme le verrou au retour
 * à la normale, pour qu'un second refus rebascule bien hors ligne.
 */
export function ChauffeurLocationGate() {
  const gate = useLocationGate();
  const blocked = gateBlocks(gate.status);
  const forcedRef = useRef(false);

  useEffect(() => {
    if (!blocked) {
      // Retour à la normale : on réarme, mais on ne remet PAS le chauffeur en
      // ligne à sa place — c'est à lui de reprendre le service (bouton GO).
      forcedRef.current = false;
      return;
    }
    if (forcedRef.current) return;
    forcedRef.current = true;
    setChauffeurOnlineLocal(false);
    // Présence serveur : best-effort (hors ligne réseau, l'écran bloque déjà).
    void setChauffeurOnline(false).catch(() => {});
  }, [blocked]);

  if (!blocked) return null;

  return (
    <LocationRequiredScreen
      role="chauffeur"
      status={gate.status}
      busy={gate.busy}
      onRequest={() => void gate.request()}
      onRecheck={() => void gate.recheck()}
      onLogout={async () => {
        setChauffeurOnlineLocal(false);
        // `chauffeurLogout` REDIRIGE si elle aboutit ; elle ne retourne un
        // objet que pour refuser (course en cours).
        const res = await chauffeurLogout();
        return res?.error ?? null;
      }}
    />
  );
}
