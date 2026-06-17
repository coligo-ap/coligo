"use client";

import { usePathname } from "next/navigation";
import { DriverHomeMap } from "./driver-home-map";

type Pin = { id: string; name: string; lat: number; lng: number };

/**
 * Carte de l'accueil livreur montée UNE SEULE FOIS dans le layout (driver) →
 * son instance MapLibre survit aux navigations entre onglets (plus de
 * re-création coûteuse à chaque retour sur l'Accueil). On la montre/cache
 * selon la route via `display` (l'instance reste vivante), et on déclenche un
 * `resize` quand elle redevient visible (le conteneur était à 0×0 en display:none).
 *
 * Placée en fond (`fixed inset-0 z-0`) : l'Accueil ne pose plus de conteneur
 * plein écran opaque, ses contrôles (GO, zone, pins, recentrer) flottent
 * au-dessus en îlots positionnés ; la carte reste donc tactile dans les zones
 * libres.
 */
export function PersistentDriverMap({ pins }: { pins: Pin[] }) {
  const pathname = usePathname();
  const isHome = pathname === "/driver";
  return (
    <div
      aria-hidden={!isHome}
      className="fixed inset-0 z-0"
      style={{ display: isHome ? "block" : "none" }}
    >
      <DriverHomeMap merchants={pins} active={isHome} />
    </div>
  );
}
