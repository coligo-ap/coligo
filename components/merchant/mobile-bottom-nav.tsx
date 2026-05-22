"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShoppingBag, Package, BarChart3, QrCode } from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

// Les 4 actions les plus fréquentes du quotidien. Le menu (sections
// secondaires) est désormais ouvert par le bouton hamburger du header,
// en haut à droite — donc pas de bouton "Menu" ici.
const NAV_ITEMS: NavItem[] = [
  { href: "/orders", label: "Commandes", icon: ShoppingBag },
  { href: "/catalog", label: "Catalogue", icon: Package },
  { href: "/stats", label: "Stats", icon: BarChart3 },
  { href: "/orders/validate", label: "Valider", icon: QrCode },
];

export function MerchantMobileBottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="border-border fixed inset-x-0 bottom-0 z-30 border-t bg-white lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="grid h-16 grid-cols-4">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          // "Valider" (/orders/validate) est plus spécifique que "Commandes"
          // (/orders) : on évite de marquer Commandes actif sur la validation.
          const active =
            item.href === "/orders"
              ? pathname === "/orders" ||
                (pathname.startsWith("/orders/") &&
                  !pathname.startsWith("/orders/validate"))
              : pathname.startsWith(item.href);
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
      </div>
    </nav>
  );
}
