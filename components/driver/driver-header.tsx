"use client";

import Link from "next/link";
import { Menu } from "lucide-react";
import { Logo } from "@/components/shared/logo";
import { driverDrawer } from "./driver-drawer-store";

/** Header fixe en haut de l'espace livreur — logo + bouton hamburger. */
export function DriverHeader({
  driverFirstName,
}: {
  driverFirstName?: string;
}) {
  return (
    <header className="border-border bg-surface sticky top-0 z-30 border-b">
      <div className="mx-auto flex max-w-md items-center justify-between gap-3 px-4 py-3">
        <Link href="/driver" className="flex items-center gap-2">
          <Logo iconOnly variant="amber" size="md" />
          <span className="text-sm font-bold tracking-tight">
            Coligo Livreur
          </span>
        </Link>
        <div className="flex items-center gap-2">
          {driverFirstName && (
            <span className="text-muted hidden text-xs sm:inline">
              {driverFirstName}
            </span>
          )}
          <button
            type="button"
            onClick={() => driverDrawer.toggle()}
            aria-label="Ouvrir le menu"
            className="hover:bg-surface-2 inline-flex size-10 items-center justify-center rounded-full"
          >
            <Menu className="size-5" />
          </button>
        </div>
      </div>
    </header>
  );
}
