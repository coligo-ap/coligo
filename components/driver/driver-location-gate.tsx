"use client";

import { useEffect, useRef } from "react";
import { useLocationGate, gateBlocks } from "@/lib/hooks/use-location-gate";
import { LocationRequiredScreen } from "@/components/shared/location-required-screen";
import { setDriverOnline } from "@/lib/driver/online-store";
import { driverLogout } from "@/app/(driver)/actions";

/**
 * Garde de LOCALISATION de l'espace livreur — montée dans le layout `(driver)`
 * pour un compte ACTIF, donc active sur tous les écrans opérationnels.
 *
 * Même règle que côté chauffeur : sans position exacte, l'écran bloquant
 * recouvre l'app et le livreur passe HORS LIGNE (l'intention locale pilote le
 * dispatch Express monté dans le layout → plus aucune course proposée). La
 * session reste ouverte : une course en cours doit rester terminable.
 *
 * La mise hors ligne n'est appliquée qu'UNE fois par épisode de blocage, et le
 * verrou se réarme au retour à la normale.
 */
export function DriverLocationGate() {
  const gate = useLocationGate();
  const blocked = gateBlocks(gate.status);
  const forcedRef = useRef(false);

  useEffect(() => {
    if (!blocked) {
      // On ne remet PAS le livreur en ligne à sa place : c'est à lui de
      // reprendre le service.
      forcedRef.current = false;
      return;
    }
    if (forcedRef.current) return;
    forcedRef.current = true;
    setDriverOnline(false);
  }, [blocked]);

  if (!blocked) return null;

  return (
    <LocationRequiredScreen
      role="livreur"
      status={gate.status}
      busy={gate.busy}
      onRequest={() => void gate.request()}
      onRecheck={() => void gate.recheck()}
      onLogout={async () => {
        setDriverOnline(false);
        // `driverLogout` REDIRIGE si elle aboutit ; elle ne retourne un objet
        // que pour refuser (course en cours).
        const res = await driverLogout();
        return res?.error ?? null;
      }}
    />
  );
}
