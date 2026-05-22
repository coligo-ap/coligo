"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShoppingBag, Package, BarChart3, Menu } from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

// 4 actions max sur mobile : les 3 plus fréquentes + le bouton Menu (drawer).
// Les autres sections vivent dans le drawer (cf. mobile-drawer.tsx).
const NAV_ITEMS: NavItem[] = [
  { href: "/orders", label: "Commandes", icon: ShoppingBag },
  { href: "/catalog", label: "Catalogue", icon: Package },
  { href: "/stats", label: "Stats", icon: BarChart3 },
];

export function MerchantMobileBottomNav({
  onOpenMenu,
  menuOpen,
}: {
  onOpenMenu: () => void;
  menuOpen: boolean;
}) {
  const pathname = usePathname();

  return (
    <nav
      className="border-border fixed inset-x-0 bottom-0 z-30 border-t bg-white lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="grid h-16 grid-cols-4">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = pathname.startsWith(item.href);
          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors",
                active ? "text-primary-700" : "text-muted"
              )}
            >
              <Icon className="size-5" />
              <span>{item.label}</span>
            </Link>
          );
        })}

        <button
          type="button"
          onClick={onOpenMenu}
          aria-label="Ouvrir le menu"
          aria-expanded={menuOpen}
          className={cn(
            "flex flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors",
            menuOpen ? "text-primary-700" : "text-muted"
          )}
        >
          <Menu className="size-5" />
          <span>Menu</span>
        </button>
      </div>
    </nav>
  );
}
