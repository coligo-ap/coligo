"use client";

import { useEffect } from "react";
import { ZoneDispatch } from "@/components/driver/home/zone-dispatch";
import { useDriverOnline } from "@/lib/driver/online-store";
import { getWorkZone } from "@/lib/driver/work-zone";
import { startBackgroundGeo } from "@/lib/native/background-geo";
import { driverHeartbeat } from "@/app/(driver)/actions";

/**
 * Monte le dispatch Express GLOBALEMENT (depuis le layout livreur), piloté par
 * l'intention « en ligne » du livreur (store partagé). Tant qu'il est en ligne,
 * il reçoit les courses Express proches sur N'IMPORTE QUELLE page livreur — pas
 * seulement l'accueil.
 *
 * En APK (natif), on lance AUSSI le suivi de position en ARRIÈRE-PLAN
 * (background-geo) : la position reste fraîche même app en arrière-plan → le
 * livreur « sonne » pour une course Express proche même sans l'app ouverte
 * (réseau global géolocalisé, mig 0130). NO-OP sur le web. Rend `null`.
 */
export function DriverDispatchMount({ userId }: { userId: string | null }) {
  const online = useDriverOnline();

  useEffect(() => {
    if (!online) return;
    const handle = startBackgroundGeo((lat, lng) => {
      // Si une zone de travail est définie, on pousse SON centre (et non le GPS
      // réel) pour que les push « nouvelle course » ciblent la zone choisie.
      const zone = getWorkZone();
      if (zone) void driverHeartbeat(zone.lat, zone.lng);
      else void driverHeartbeat(lat, lng);
    });
    return () => handle.stop();
  }, [online]);

  return <ZoneDispatch online={online} userId={userId} />;
}
