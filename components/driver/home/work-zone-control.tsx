"use client";

import { useState } from "react";
import { useLocale } from "next-intl";
import { Crosshair, MapPin } from "lucide-react";
import { useWorkZone } from "@/lib/driver/work-zone";
import { WorkZoneSheet } from "./work-zone-sheet";

/**
 * Pilule d'état + ouverture du sélecteur de zone (accueil livreur). Affiche le
 * mode courant : « Autour de moi » (GPS live) ou « Zone · N km ».
 */
export function WorkZoneControl() {
  const zone = useWorkZone();
  const isAr = useLocale() === "ar";
  const tr = (fr: string, ar: string) => (isAr ? ar : fr);
  const [open, setOpen] = useState(false);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="home-fab-right absolute z-[55] inline-flex items-center gap-1.5 rounded-full bg-[var(--surface)] px-3.5 py-2 text-[12.5px] font-bold text-[var(--violet)] shadow-[0_4px_16px_rgba(0,0,0,.14)] active:scale-95"
        style={{
          top: "max(106px, calc(env(safe-area-inset-top) + 64px))",
        }}
        aria-label={tr("Définir ma zone de travail", "تحديد منطقة عملي")}
      >
        {zone ? (
          <>
            <MapPin className="size-4" />
            {tr("Zone", "منطقة")} · {zone.radiusKm} km
          </>
        ) : (
          <>
            <Crosshair className="size-4" />
            {tr("Zone de travail", "منطقة العمل")}
          </>
        )}
      </button>

      <WorkZoneSheet open={open} onClose={() => setOpen(false)} />
    </>
  );
}
