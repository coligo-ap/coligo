"use client";

import { Bell, LogOut } from "lucide-react";
import { Logo } from "@/components/shared/logo";
import { logout } from "@/app/(merchant)/actions";

interface MerchantMobileHeaderProps {
  merchantName: string;
  pendingCount?: number;
}

export function MerchantMobileHeader({
  merchantName,
  pendingCount = 0,
}: MerchantMobileHeaderProps) {
  return (
    <header className="lg:hidden sticky top-0 z-30 bg-white border-b border-border px-4 h-14 flex items-center justify-between">
      <Logo variant="amber" size="sm" subtitle={merchantName} />

      <div className="flex items-center gap-1">
        <button
          className="relative size-9 rounded-full hover:bg-surface-3 flex items-center justify-center text-muted"
          aria-label="Notifications"
        >
          <Bell className="size-4" />
          {pendingCount > 0 && (
            <span className="absolute top-1.5 right-1.5 size-2 bg-rose-500 rounded-full ring-2 ring-white" />
          )}
        </button>

        <form action={logout}>
          <button
            type="submit"
            className="size-9 rounded-full hover:bg-surface-3 flex items-center justify-center text-muted"
            aria-label="Se déconnecter"
          >
            <LogOut className="size-4" />
          </button>
        </form>
      </div>
    </header>
  );
}
