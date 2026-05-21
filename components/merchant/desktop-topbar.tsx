"use client";

import { Bell, Search, ChevronDown, LogOut, User } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { logout } from "@/app/(merchant)/actions";

interface MerchantTopbarProps {
  userEmail: string;
  merchantName: string;
  pendingCount?: number;
}

export function MerchantTopbar({
  userEmail,
  merchantName,
  pendingCount = 0,
}: MerchantTopbarProps) {
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const handler = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMenuOpen(false);
      }
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const initials = merchantName
    .split(" ")
    .slice(0, 2)
    .map((w) => w.charAt(0))
    .join("")
    .toUpperCase();

  return (
    <header className="hidden lg:flex sticky top-0 z-20 h-16 bg-white border-b border-border px-6 items-center gap-4">
      <div className="relative flex-1 max-w-xl">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 size-4 text-subtle" />
        <input
          type="search"
          placeholder="Rechercher une commande, un client, un produit…"
          className="w-full h-10 pl-10 pr-4 rounded-[10px] border border-border bg-surface-2 text-sm focus:outline-none focus:bg-white focus:border-primary-400 focus:ring-2 focus:ring-primary-400/20 transition-all"
        />
        <kbd className="hidden xl:flex absolute right-3 top-1/2 -translate-y-1/2 items-center gap-1 px-1.5 py-0.5 rounded border border-border bg-white text-[10px] text-muted font-mono">
          ⌘ K
        </kbd>
      </div>

      <div className="flex items-center gap-2 ml-auto">
        <button
          className="relative size-10 rounded-full hover:bg-surface-3 flex items-center justify-center text-muted transition-colors"
          aria-label="Notifications"
        >
          <Bell className="size-4" />
          {pendingCount > 0 && (
            <span className="absolute top-1.5 right-1.5 size-2 bg-rose-500 rounded-full ring-2 ring-white" />
          )}
        </button>

        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="flex items-center gap-2 pl-2 pr-3 py-1.5 rounded-full hover:bg-surface-3 transition-colors"
          >
            <div className="size-8 rounded-full bg-primary-100 text-primary-800 flex items-center justify-center text-xs font-semibold">
              {initials}
            </div>
            <ChevronDown className="size-3.5 text-muted" />
          </button>

          {menuOpen && (
            <div className="absolute right-0 top-full mt-1 w-64 bg-white border border-border rounded-[12px] shadow-lg overflow-hidden">
              <div className="px-4 py-3 border-b border-surface-3">
                <div className="text-sm font-medium truncate">{merchantName}</div>
                <div className="text-xs text-muted truncate">{userEmail}</div>
              </div>
              <div className="py-1">
                <button className="w-full px-4 py-2 text-left text-sm hover:bg-surface-2 flex items-center gap-2 text-foreground">
                  <User className="size-3.5" />
                  Mon profil
                </button>
              </div>
              <div className="border-t border-surface-3">
                <form action={logout}>
                  <button
                    type="submit"
                    className="w-full px-4 py-2 text-left text-sm hover:bg-surface-2 flex items-center gap-2 text-rose-600"
                  >
                    <LogOut className="size-3.5" />
                    Se déconnecter
                  </button>
                </form>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}
