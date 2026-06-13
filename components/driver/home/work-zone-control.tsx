"use client";

import { useState } from "react";
import { Crosshair, MapPin } from "lucide-react";
import { useWorkZone } from "@/lib/driver/work-zone";
import { WorkZoneSheet } from "./work-zone-sheet";

/**
 * Pilule d'état + ouverture du sélecteur de zone (accueil livreur). Affiche le
 * mode courant : « Autour de moi » (GPS live) ou « Zone · N km ».
 */
export function WorkZoneControl() {
  const zone = useWorkZone();
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="absolute right-4 z-[55] inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-2 text-[12.5px] font-bold text-[#4b1fa6] shadow-[0_4px_16px_rgba(0,0,0,.14)] active:scale-95"
        style={{
          top: "max(106px, calc(env(safe-area-inset-top) + 64px))",
        }}
        aria-label="Définir ma zone de travail"
      >
        {zone ? (
          <>
            <MapPin className="size-4" />
            Zone · {zone.radiusKm} km
          </>
        ) : (
          <>
            <Crosshair className="size-4" />
            Autour de moi
          </>
        )}
      </button>

      <WorkZoneSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}
