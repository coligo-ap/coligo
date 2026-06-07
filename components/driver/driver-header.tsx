"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { RotateCw } from "lucide-react";

/**
 * Header de l'espace livreur (style Uber) — fond blanc, titre, bouton
 * d'actualisation + bouton menu rond à droite.
 */
export function DriverHeader({
  driverFirstName,
}: {
  driverFirstName?: string;
}) {
  const router = useRouter();
  const [spinning, setSpinning] = useState(false);

  const refresh = () => {
    setSpinning(true);
    router.refresh();
    setTimeout(() => setSpinning(false), 800);
  };

  return (
    <header className="sticky top-0 z-30 border-b border-[#eee] bg-white">
      <div className="mx-auto flex max-w-md items-center justify-between gap-3 px-4 py-3">
        <div className="min-w-0">
          <p className="text-[15px] font-extrabold tracking-tight text-[#0a0a0a]">
            Coligo Livreur
          </p>
          {driverFirstName && (
            <p className="-mt-0.5 truncate text-[11px] font-medium text-[#757575]">
              {driverFirstName}
            </p>
          )}
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={refresh}
            aria-label="Actualiser la page"
            className="grid size-10 place-items-center rounded-full bg-[#f5f5f5] text-[#0a0a0a] active:scale-95"
          >
            <RotateCw
              className={"size-5 " + (spinning ? "animate-spin" : "")}
            />
          </button>
        </div>
      </div>
    </header>
  );
}
