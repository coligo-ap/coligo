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
    <header className="border-border sticky top-0 z-30 flex h-14 items-center justify-between border-b bg-white px-4 lg:hidden">
      <Logo variant="amber" size="sm" subtitle={merchantName} />

      <div className="flex items-center gap-1">
        <button
          className="hover:bg-surface-3 text-muted relative flex size-9 items-center justify-center rounded-full"
          aria-label="Notifications"
        >
          <Bell className="size-4" />
          {pendingCount > 0 && (
            <span className="absolute top-1.5 right-1.5 size-2 rounded-full bg-rose-500 ring-2 ring-white" />
          )}
        </button>

        <form action={logout}>
          <button
            type="submit"
            className="hover:bg-surface-3 text-muted flex size-9 items-center justify-center rounded-full"
            aria-label="Se déconnecter"
          >
            <LogOut className="size-4" />
          </button>
        </form>
      </div>
    </header>
  );
}
