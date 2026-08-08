"use client";

import Link from "next/link";
import { Bell, Menu } from "lucide-react";
import { Logo } from "@/components/shared/logo";
import {
  mobileDrawer,
  useMobileDrawerOpen,
} from "@/components/merchant/use-mobile-drawer";
import { SyncIndicator } from "@/components/merchant/sync-indicator";
import { ShopStatusToggle } from "@/components/merchant/shop-status-toggle";
import type { MerchantPauseInput } from "@/lib/merchant/pause-state";

interface MerchantMobileHeaderProps {
  merchantName: string;
  pendingCount?: number;
  pauseInput: MerchantPauseInput;
}

export function MerchantMobileHeader({
  merchantName,
  pendingCount = 0,
  pauseInput,
}: MerchantMobileHeaderProps) {
  const open = useMobileDrawerOpen();

  return (
    <header className="border-border sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-white px-4 pt-[env(safe-area-inset-top)] lg:hidden [@supports(padding:env(safe-area-inset-top))]:h-[calc(3.5rem+env(safe-area-inset-top))]">
      <Logo variant="amber" size="sm" subtitle={merchantName} />

      <div className="flex items-center gap-1.5">
        {/* Wallet Coligo Pay déplacé vers le bandeau du dashboard. */}
        <ShopStatusToggle input={pauseInput} />
        {/* Indicateur résilience offline (mobile = simple pastille, panneau
            ancré sous l'icône). */}
        <div className="relative">
          <SyncIndicator />
        </div>

        {/* Cloche → commandes à confirmer (badge = nombre en attente). */}
        <Link
          href="/orders?status=pending"
          className="hover:bg-surface-3 text-muted relative flex size-9 items-center justify-center rounded-full"
          aria-label={
            pendingCount > 0
              ? `${pendingCount} commande(s) à confirmer`
              : "Commandes à confirmer"
          }
        >
          <Bell className="size-4" />
          {pendingCount > 0 && (
            <span className="text-micro absolute -top-0.5 -right-0.5 inline-flex min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 font-bold text-white ring-2 ring-white">
              {pendingCount}
            </span>
          )}
        </Link>

        {/* Bouton menu — ouvre le drawer (sections secondaires) */}
        <button
          type="button"
          onClick={() => mobileDrawer.open()}
          aria-label="Ouvrir le menu"
          aria-expanded={open}
          className="hover:bg-surface-3 text-muted flex size-9 items-center justify-center rounded-full"
        >
          <Menu className="size-5" />
        </button>
      </div>
    </header>
  );
}
