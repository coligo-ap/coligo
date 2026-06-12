import Image from "next/image";
import { BRAND_ASSETS } from "@/lib/config/brand-assets";

/**
 * Écran d'attente de l'espace livreur — affiché par Next pendant le chargement
 * serveur d'une page du groupe (driver), notamment lors du passage depuis le
 * portail commerçant (« page blanche entre temps »). Même langage visuel que
 * `DriverSplash` (fond sombre, logo complet blanc, barre indéterminée) pour
 * une transition fluide splash → loader → app.
 */
export default function DriverLoading() {
  return (
    <div className="fixed inset-0 z-[150] flex flex-col items-center justify-center bg-[#0a0a0a]">
      {/* Halo violet de marque derrière le logo. */}
      <div
        aria-hidden
        className="pointer-events-none absolute size-[280px] rounded-full"
        style={{
          background:
            "radial-gradient(circle, rgba(108,43,217,.35) 0%, rgba(108,43,217,0) 70%)",
        }}
      />
      <div className="relative flex flex-col items-center gap-4">
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
