"use client";

import Link from "next/link";
import { Bell, Search, ChevronDown, Loader2, LogOut, User } from "lucide-react";
import { useState, useRef, useEffect } from "react";
import { useFormStatus } from "react-dom";
import { logout } from "@/app/(merchant)/actions";
import { SyncIndicator } from "@/components/merchant/sync-indicator";
import { ShopStatusToggle } from "@/components/merchant/shop-status-toggle";

interface MerchantTopbarProps {
  userEmail: string;
  merchantName: string;
  pendingCount?: number;
  ordersPaused?: boolean;
}

export function MerchantTopbar({
  userEmail,
  merchantName,
  pendingCount = 0,
  ordersPaused = false,
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
    <header className="border-border sticky top-0 z-20 hidden h-16 items-center gap-4 border-b bg-white px-6 lg:flex">
      <div className="relative max-w-xl flex-1">
        <Search className="text-subtle absolute top-1/2 left-3 size-4 -translate-y-1/2" />
        <input
          type="search"
          placeholder="Rechercher une commande, un client, un produit…"
          className="border-border bg-surface-2 focus:border-primary-400 focus:ring-primary-400/20 h-10 w-full rounded-[10px] border pr-4 pl-10 text-sm transition-all focus:bg-white focus:ring-2 focus:outline-none"
        />
        <kbd className="border-border text-muted absolute top-1/2 right-3 hidden -translate-y-1/2 items-center gap-1 rounded border bg-white px-1.5 py-0.5 font-mono text-[10px] xl:flex">
          ⌘ K
        </kbd>
      </div>

      <div className="ml-auto flex items-center gap-2">
        {/* Ouvrir / Fermer la réception de commandes (immédiat). */}
        <ShopStatusToggle initialPaused={ordersPaused} />

        {/* Indicateur résilience offline — pastille + panneau de la file
            d'actions différées. Discret par défaut. */}
        <div className="relative">
          <SyncIndicator />
        </div>

        {/* Cloche → commandes à confirmer (badge = nombre en attente). */}
        <Link
          href="/orders?status=pending"
          className="hover:bg-surface-3 text-muted relative flex size-10 items-center justify-center rounded-full transition-colors"
          aria-label={
            pendingCount > 0
              ? `${pendingCount} commande(s) à confirmer`
              : "Commandes à confirmer"
          }
        >
          <Bell className="size-4" />
          {pendingCount > 0 && (
            <span className="absolute -top-0.5 -right-0.5 inline-flex min-w-[16px] items-center justify-center rounded-full bg-rose-500 px-1 text-[10px] font-bold text-white ring-2 ring-white">
              {pendingCount}
            </span>
          )}
        </Link>

        <div className="relative" ref={menuRef}>
          <button
            onClick={() => setMenuOpen(!menuOpen)}
            className="hover:bg-surface-3 flex items-center gap-2 rounded-full py-1.5 pr-3 pl-2 transition-colors"
          >
            <div className="bg-primary-100 text-primary-800 flex size-8 items-center justify-center rounded-full text-xs font-semibold">
              {initials}
            </div>
            <ChevronDown className="text-muted size-3.5" />
          </button>

          {menuOpen && (
            <div className="border-border absolute top-full right-0 mt-1 w-64 overflow-hidden rounded-[12px] border bg-white shadow-lg">
              <div className="border-surface-3 border-b px-4 py-3">
                <div className="truncate text-sm font-medium">
                  {merchantName}
                </div>
                <div className="text-muted truncate text-xs">{userEmail}</div>
              </div>
              <div className="py-1">
                <button className="hover:bg-surface-2 text-foreground flex w-full items-center gap-2 px-4 py-2 text-left text-sm">
                  <User className="size-3.5" />
                  Mon profil
                </button>
              </div>
              <div className="border-surface-3 border-t">
                <form action={logout}>
                  <TopbarLogoutButton />
                </form>
              </div>
            </div>
          )}
        </div>
      </div>
    </header>
  );
}

function TopbarLogoutButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="text-danger-700 hover:bg-danger-50 flex w-full items-center gap-2 px-4 py-2 text-left text-sm font-semibold disabled:opacity-60"
    >
      {pending ? (
        <Loader2 className="size-3.5 animate-spin" />
      ) : (
        <LogOut className="size-3.5" />
      )}
      {pending ? "Déconnexion…" : "Déconnexion"}
    </button>
  );
}
