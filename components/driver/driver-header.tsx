"use client";

import { Menu } from "lucide-react";
import { driverDrawer } from "./driver-drawer-store";

/**
 * Header de l'espace livreur (style Uber) — fond blanc, titre, bouton menu
 * rond gris à droite. Sobre, mobile-first.
 */
export function DriverHeader({
  driverFirstName,
}: {
  driverFirstName?: string;
}) {
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
        <button
          type="button"
          onClick={() => driverDrawer.toggle()}
          aria-label="Ouvrir le menu"
          className="grid size-10 shrink-0 place-items-center rounded-full bg-[#f5f5f5] text-[#0a0a0a] active:scale-95"
        >
          <Menu className="size-5" />
        </button>
      </div>
    </header>
  );
}
