"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Home, ShoppingBag, Package, BarChart3, QrCode } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  NavAlertBadge,
  type AlertOrderLite,
} from "@/components/merchant/nav-alert-badge";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
};

// Les 5 actions les plus fréquentes du quotidien, « Accueil » (le tableau de
// bord / board live) en premier. Le menu (sections secondaires) est ouvert par
// le bouton hamburger du header, en haut à droite — donc pas de bouton "Menu".
const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Accueil", icon: Home },
  { href: "/orders", label: "Commandes", icon: ShoppingBag },
  { href: "/catalog", label: "Catalogue", icon: Package },
  { href: "/stats", label: "Stats", icon: BarChart3 },
  { href: "/orders/validate", label: "Valider", icon: QrCode },
];

export function MerchantMobileBottomNav({
  alertOrders = [],
}: {
  alertOrders?: AlertOrderLite[];
}) {
  const pathname = usePathname();

  return (
    <nav
      className="border-border fixed inset-x-0 bottom-0 z-30 border-t bg-white lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="grid h-16 grid-cols-5">
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
                // `min-w-0` + libellé `truncate` : police système agrandie ⇒
                // le libellé se tronque au lieu de déborder sur le voisin.
                "flex min-w-0 flex-col items-center justify-center gap-1 px-0.5 text-[10px] font-medium transition-colors",
                active ? "text-primary-700" : "text-muted"
              )}
            >
              <span className="relative">
                <Icon className="size-5" />
                {/* Alerte board (à confirmer + en retard) sur « Accueil » :
                    visible depuis n'importe quelle page. */}
                {item.href === "/dashboard" && (
                  <NavAlertBadge
                    orders={alertOrders}
                    className="absolute -end-2.5 -top-1.5"
                  />
                )}
              </span>
              <span className="max-w-full truncate">{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
