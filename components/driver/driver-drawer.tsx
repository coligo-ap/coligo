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
  Settings,
  Truck,
  Wallet,
  X,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/shared/logo";
import { Separator } from "@/components/ui/separator";
import { driverLogout } from "@/app/(driver)/actions";
import { driverDrawer, useDriverDrawerOpen } from "./driver-drawer-store";

type Item = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  hint?: string;
};

const PRIMARY: Item[] = [
  { href: "/driver", label: "Accueil", icon: Home },
  { href: "/driver/historique", label: "Historique livraisons", icon: History },
  { href: "/driver/gains", label: "Mes gains", icon: Wallet },
  { href: "/driver/codes", label: "Rejoindre un commerçant", icon: KeyRound },
];

const SECONDARY: Item[] = [
  { href: "/driver/parametres", label: "Paramètres", icon: Settings },
];

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
    <div className="fixed inset-0 z-40">
      {/* Backdrop */}
      <button
        type="button"
        aria-label="Fermer le menu"
        onClick={() => driverDrawer.close()}
        className="absolute inset-0 bg-black/40"
      />
      {/* Panel */}
      <aside className="bg-surface absolute inset-y-0 right-0 flex w-72 max-w-[88vw] flex-col shadow-xl">
        <header className="border-border flex items-center justify-between gap-3 border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <Logo iconOnly variant="amber" size="md" />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">
                {driverFirstName ?? "Livreur"}
              </p>
              <p className="text-muted text-xs">Coligo Livreur</p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => driverDrawer.close()}
            aria-label="Fermer"
            className="hover:bg-surface-2 inline-flex size-9 items-center justify-center rounded-full"
          >
            <X className="size-4" />
          </button>
        </header>

        <nav className="flex-1 overflow-y-auto px-2 py-2">
          {PRIMARY.map((it) => (
            <DrawerItem key={it.href} item={it} active={pathname === it.href} />
          ))}
          <Separator className="my-2" />
          {SECONDARY.map((it) => (
            <DrawerItem key={it.href} item={it} active={pathname === it.href} />
          ))}
        </nav>

        <Separator />

        <form action={driverLogout} className="p-3">
          <LogoutButton />
        </form>
      </aside>
    </div>
  );
}

function DrawerItem({ item, active }: { item: Item; active: boolean }) {
  const Icon = item.icon;
  return (
    <Link
      href={item.href}
      className={cn(
        "flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-sm font-medium transition-colors",
        active
          ? "bg-primary-50 text-primary-700"
          : "text-foreground hover:bg-surface-2"
      )}
    >
      <Icon className="size-4 shrink-0" />
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
      className="border-danger-200 bg-danger-50 text-danger-700 hover:bg-danger-100 flex min-h-[44px] w-full items-center justify-center gap-2 rounded-[10px] border px-3 py-2 text-sm font-semibold transition-colors disabled:opacity-60"
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
