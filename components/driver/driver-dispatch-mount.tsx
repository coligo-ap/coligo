"use client";

import { ZoneDispatch } from "@/components/driver/home/zone-dispatch";
import { useDriverOnline } from "@/lib/driver/online-store";

/**
 * Monte le dispatch Express GLOBALEMENT (depuis le layout livreur), piloté par
 * l'intention « en ligne » du livreur (store partagé). Tant qu'il est en ligne,
 * il reçoit les courses Express proches sur N'IMPORTE QUELLE page livreur — pas
 * seulement l'accueil. Rend `null` (aucun visuel).
 */
export function DriverDispatchMount() {
  const online = useDriverOnline();
  return <ZoneDispatch online={online} />;
}
