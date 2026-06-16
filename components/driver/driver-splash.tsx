"use client";

import { useEffect, useState } from "react";
import Image from "next/image";
import { BRAND_ASSETS } from "@/lib/config/brand-assets";

/**
 * Écran de LANCEMENT de l'espace livreur (façon ouverture d'app mobile).
 *
 * Plein écran sombre + logo Coligo centré + barre de chargement, puis fondu de
 * sortie. Affiché UNE fois par session (sessionStorage) → pas de re-flash à
 * chaque navigation interne. L'app Capacitor charge une URL distante : ce splash
 * web prend le relais du splash natif le temps que l'interface s'initialise.
 */
const KEY = "coligo_driver_splash_seen";

export function DriverSplash() {
  const [phase, setPhase] = useState<"init" | "show" | "fade" | "done">("init");

  useEffect(() => {
    let seen = false;
    try {
      seen = sessionStorage.getItem(KEY) === "1";
    } catch {
      /* sessionStorage indispo → on montre le splash quand même */
    }
    if (seen) {
      setPhase("done");
      return;
    }
    setPhase("show");
    const t1 = setTimeout(() => setPhase("fade"), 900);
    const t2 = setTimeout(() => {
      setPhase("done");
      try {
        sessionStorage.setItem(KEY, "1");
      } catch {
        /* no-op */
      }
    }, 1250);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);

  if (phase === "init" || phase === "done") return null;

  return (
    <div
      aria-hidden
      className="fixed inset-0 z-[200] flex flex-col items-center justify-center bg-[#4b1fa6] transition-opacity duration-300 ease-out"
      style={{
        opacity: phase === "fade" ? 0 : 1,
        pointerEvents: phase === "fade" ? "none" : "auto",
      }}
    >
      {/* Halo violet de marque derrière le logo. */}
      <div
        className="pointer-events-none absolute size-[280px] rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgba(138,77,255,.55) 0%, rgba(138,77,255,0) 70%)",
        }}
      />
      <div
        className="relative flex flex-col items-center gap-4"
        style={{ animation: "driver-splash-rise .45s ease-out both" }}
      >
        {/* Logo Coligo COMPLET (FR + AR) en blanc — cf. lib/config/brand-assets. */}
        <Image
          src={BRAND_ASSETS.fullWhite}
          alt="Coligo"
          width={1000}
          height={401}
          priority
          className="h-auto w-[200px]"
        />
        <p className="text-[10px] font-semibold tracking-[3px] text-white/45 uppercase">
          Livreur
        </p>
      </div>

      {/* Barre de chargement indéterminée (dégradé signature). */}
      <div className="absolute bottom-[12%] h-[3px] w-[120px] overflow-hidden rounded-full bg-white/10">
        <div
          className="h-full w-1/3 rounded-full"
          style={{
            background: "linear-gradient(90deg,#5b2eff,#8a4dff)",
            animation: "driver-splash-bar 1s ease-in-out infinite",
          }}
        />
      </div>
    </div>
  );
}
