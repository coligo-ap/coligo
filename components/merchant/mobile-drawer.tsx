"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef } from "react";
import {
  HelpCircle,
  LayoutDashboard,
  LogOut,
  Settings,
  Tag,
  Wallet,
  X,
} from "lucide-react";
import { Logo } from "@/components/shared/logo";
import { Separator } from "@/components/ui/separator";
import { cn } from "@/lib/utils";
import { logout } from "@/app/(merchant)/actions";
import { InstallButton } from "@/components/pwa/install-button";
import {
  mobileDrawer,
  useMobileDrawerOpen,
} from "@/components/merchant/use-mobile-drawer";

type DrawerItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  disabled?: boolean;
};

// Sections secondaires (celles retirées de la bottom-nav) + bientôt-disponibles.
const DRAWER_ITEMS: DrawerItem[] = [
  { href: "/dashboard", label: "Tableau de bord", icon: LayoutDashboard },
  { href: "/promotions", label: "Promotions", icon: Tag },
  { href: "/finances", label: "Finances", icon: Wallet },
  { href: "/settings", label: "Paramètres", icon: Settings, disabled: true },
];

export function MobileDrawer({
  merchantName,
  email,
}: {
  merchantName: string;
  email: string;
}) {
  const open = useMobileDrawerOpen();
  const pathname = usePathname();
  const closeRef = useRef<HTMLButtonElement>(null);
  const close = () => mobileDrawer.close();

  // Échap pour fermer, blocage du scroll de la page, focus sur le bouton X.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") mobileDrawer.close();
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  return (
    <div className={cn("lg:hidden", !open && "pointer-events-none")}>
      {/* Overlay sombre */}
      <div
        onClick={close}
        aria-hidden="true"
        className={cn(
          "fixed inset-0 z-40 bg-black/40 transition-opacity duration-200",
          open ? "opacity-100" : "opacity-0"
        )}
      />

      {/* Panneau coulissant — depuis la DROITE */}
      <aside
        role="dialog"
        aria-modal="true"
        aria-label="Menu de navigation"
        className={cn(
          "fixed inset-y-0 right-0 z-50 flex w-[82%] max-w-xs flex-col bg-white shadow-xl transition-transform duration-200 ease-out",
          open ? "translate-x-0" : "translate-x-full"
        )}
      >
        {/* Identité du commerce */}
        <div className="border-border flex items-start justify-between gap-3 border-b p-4">
          <div className="flex min-w-0 items-center gap-3">
            <Logo iconOnly variant="amber" size="md" />
            <div className="min-w-0">
              <p className="truncate font-semibold">{merchantName}</p>
              {email && <p className="text-muted truncate text-xs">{email}</p>}
            </div>
          </div>
          <button
            ref={closeRef}
            type="button"
            onClick={close}
            aria-label="Fermer le menu"
            className="text-muted hover:bg-surface-2 hover:text-foreground flex size-10 shrink-0 items-center justify-center rounded-full"
          >
            <X className="size-5" />
          </button>
        </div>

        {/* Navigation secondaire */}
        <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
          {DRAWER_ITEMS.map((item) => {
            const Icon = item.icon;

            if (item.disabled) {
              return (
                <div
                  key={item.href}
                  className="text-subtle flex min-h-[44px] cursor-not-allowed items-center gap-3 rounded-[10px] px-3 py-2 text-sm"
                  title="Bientôt disponible"
                >
                  <Icon className="size-5 shrink-0" />
                  <span className="flex-1">{item.label}</span>
                  <span className="text-subtle text-[10px] tracking-wider uppercase">
                    Bientôt
                  </span>
                </div>
              );
            }

            const active = pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                onClick={close}
                className={cn(
                  "flex min-h-[44px] items-center gap-3 rounded-[10px] px-3 py-2 text-sm transition-colors",
                  active
                    ? "bg-primary-50 text-primary-900 font-medium"
                    : "text-muted hover:bg-surface-2 hover:text-foreground"
                )}
              >
                <Icon className="size-5 shrink-0" />
                <span className="flex-1">{item.label}</span>
              </Link>
            );
          })}

          <a
            href="#"
            onClick={close}
            className="text-muted hover:bg-surface-2 hover:text-foreground flex min-h-[44px] items-center gap-3 rounded-[10px] px-3 py-2 text-sm transition-colors"
          >
            <HelpCircle className="size-5 shrink-0" />
            <span className="flex-1">Centre d&apos;aide</span>
          </a>

          <InstallButton variant="nav" onAfterPrompt={close} />
        </nav>

        <Separator />

        {/* Déconnexion (Server Action existante) */}
        <form action={logout} className="p-3">
          <button
            type="submit"
            className="text-danger-600 hover:bg-danger-50 flex min-h-[44px] w-full items-center gap-3 rounded-[10px] px-3 py-2 text-sm font-medium transition-colors"
          >
            <LogOut className="size-5 shrink-0" />
            Se déconnecter
          </button>
        </form>
      </aside>
    </div>
  );
}
