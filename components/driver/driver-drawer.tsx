"use client";

import Link from "next/link";
import { useEffect } from "react";
import { usePathname } from "next/navigation";
import { useFormStatus } from "react-dom";
import {
  History,
  Home,
  KeyRound,
  Loader2,
  LogOut,
  User,
  Wallet,
  X,
} from "lucide-react";
import { driverLogout } from "@/app/(driver)/actions";
import { driverDrawer, useDriverDrawerOpen } from "./driver-drawer-store";

type Item = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

const ITEMS: Item[] = [
  { href: "/driver", label: "Accueil", icon: Home },
  { href: "/driver/historique", label: "Historique livraisons", icon: History },
  { href: "/driver/gains", label: "Mes gains", icon: Wallet },
  { href: "/driver/codes", label: "Rejoindre un commerçant", icon: KeyRound },
  { href: "/driver/parametres", label: "Mon profil", icon: User },
];

function initialsOf(name?: string) {
  if (!name) return "L";
  const p = name.trim().split(/\s+/).filter(Boolean);
  return (p[0]?.charAt(0) ?? "L").toUpperCase();
}

export function DriverDrawer({
  driverFirstName,
}: {
  driverFirstName?: string;
}) {
  const open = useDriverDrawerOpen();
  const pathname = usePathname();

  // Ferme le drawer au changement de route (navigation interne).
  useEffect(() => {
    driverDrawer.close();
  }, [pathname]);

  // Échap = close.
  useEffect(() => {
    if (!open) return;
    const h = (e: KeyboardEvent) => {
      if (e.key === "Escape") driverDrawer.close();
    };
    window.addEventListener("keydown", h);
    return () => window.removeEventListener("keydown", h);
  }, [open]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[70]">
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Fermer le menu"
        onClick={() => driverDrawer.close()}
        className="absolute inset-0 bg-black/40"
      />
      {/* Panel */}
      <aside className="absolute inset-y-0 right-0 flex w-80 max-w-[88vw] flex-col bg-white shadow-[0_0_40px_rgba(0,0,0,.25)]">
        <header className="flex items-center justify-between gap-3 border-b border-[#eee] px-4 py-4">
          <div className="flex min-w-0 items-center gap-3">
            <div className="grid size-11 shrink-0 place-items-center rounded-full bg-black text-base font-black text-white">
              {initialsOf(driverFirstName)}
            </div>
            <div className="min-w-0">
              <p className="truncate text-[15px] font-extrabold text-[#0a0a0a]">
                {driverFirstName ?? "Livreur"}
              </p>
              <p className="text-[11px] font-medium text-[#757575]">
                Coligo Livreur
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => driverDrawer.close()}
            aria-label="Fermer"
            className="grid size-9 shrink-0 place-items-center rounded-full bg-[#f5f5f5] text-[#0a0a0a] active:scale-95"
          >
            <X className="size-4" />
          </button>
        </header>

        <nav className="flex-1 overflow-y-auto p-3">
          {ITEMS.map((it) => (
            <DrawerItem key={it.href} item={it} active={pathname === it.href} />
          ))}
        </nav>

        <div className="border-t border-[#eee] p-3">
          <form action={driverLogout}>
            <LogoutButton />
          </form>
        </div>
      </aside>
    </div>
  );
}

function DrawerItem({ item, active }: { item: Item; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={
        "mb-1 flex items-center gap-3 rounded-[12px] px-3 py-2.5 text-[14px] font-semibold transition-colors " +
        (active
          ? "bg-[#f2f2f2] text-[#0a0a0a]"
          : "text-[#1a1a1a] active:bg-[#f5f5f5]")
      }
    >
      <span
        className={
          "grid size-9 shrink-0 place-items-center rounded-full " +
          (active ? "bg-black text-white" : "bg-[#f5f5f5] text-[#0a0a0a]")
        }
      >
        <Icon className="size-[18px]" />
      </span>
      <span className="flex-1 truncate">{item.label}</span>
    </Link>
  );
}

function LogoutButton() {
  const { pending } = useFormStatus();
  return (
    <button
      type="submit"
      disabled={pending}
      className="flex min-h-[48px] w-full items-center justify-center gap-2 rounded-[12px] bg-[#fff3f2] text-[14px] font-bold text-[#e53935] active:scale-[0.99] disabled:opacity-60"
    >
      {pending ? (
        <Loader2 className="size-5 shrink-0 animate-spin" />
      ) : (
        <LogOut className="size-5 shrink-0" />
      )}
      {pending ? "Déconnexion…" : "Déconnexion"}
    </button>
  );
}
