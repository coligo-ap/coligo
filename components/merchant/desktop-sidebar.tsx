"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Package,
  ShoppingBag,
  QrCode,
  ScanLine,
  BarChart3,
  Tag,
  Truck,
  Wallet,
  Settings,
  HelpCircle,
  Smartphone,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/shared/logo";
import {
  NavAlertBadge,
  type AlertOrderLite,
} from "@/components/merchant/nav-alert-badge";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string | number;
  disabled?: boolean;
};

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Tableau de bord", icon: LayoutDashboard },
  { href: "/orders", label: "Commandes", icon: ShoppingBag },
  { href: "/orders/validate", label: "Valider retrait", icon: QrCode },
  { href: "/encaisser", label: "Encaisser (QR)", icon: ScanLine },
  { href: "/catalog", label: "Catalogue", icon: Package },
  { href: "/promotions", label: "Promotions", icon: Tag },
  { href: "/stats", label: "Statistiques", icon: BarChart3 },
  { href: "/livreurs", label: "Livreurs", icon: Truck },
  { href: "/finances", label: "Finances", icon: Wallet },
  { href: "/settings", label: "Paramètres", icon: Settings },
];

export function MerchantSidebar({
  merchantName,
  alertOrders = [],
}: {
  merchantName: string;
  alertOrders?: AlertOrderLite[];
}) {
  const pathname = usePathname();

  return (
    <aside className="lg:border-border z-30 hidden lg:fixed lg:inset-y-0 lg:flex lg:w-60 lg:flex-col lg:border-r lg:bg-white">
      <div className="border-border border-b px-5 py-5">
        <Logo variant="amber" size="md" subtitle={merchantName} />
      </div>

      <nav className="flex-1 space-y-0.5 overflow-y-auto px-3 py-4">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = pathname.startsWith(item.href);

          if (item.disabled) {
            return (
              <div
                key={item.href}
                className="text-subtle flex cursor-not-allowed items-center gap-3 rounded-[10px] px-3 py-2 text-sm"
                title="Bientôt disponible"
              >
                <Icon className="size-4 shrink-0" />
                <span className="flex-1">{item.label}</span>
                <span className="text-subtle text-[10px] tracking-wider uppercase">
                  Bientôt
                </span>
              </div>
            );
          }

          return (
            <Link
              key={item.href}
              href={item.href}
              className={cn(
                "flex items-center gap-3 rounded-[10px] px-3 py-2 text-sm transition-colors",
                active
                  ? "bg-primary-50 text-primary-900 font-medium"
                  : "text-muted hover:bg-surface-2 hover:text-foreground"
              )}
            >
              <Icon className="size-4 shrink-0" />
              <span className="flex-1">{item.label}</span>
              {/* Alerte board (à confirmer + en retard) sur le tableau de bord. */}
              {item.href === "/dashboard" && (
                <NavAlertBadge orders={alertOrders} />
              )}
              {item.badge !== undefined && (
                <span className="bg-primary-100 text-primary-800 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tabular-nums">
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="border-border space-y-0.5 border-t px-3 py-4">
        <Link
          href="/telecharger"
          className={cn(
            "flex w-full items-center gap-3 rounded-[10px] px-3 py-2 text-sm transition-colors",
            pathname.startsWith("/telecharger")
              ? "bg-primary-50 text-primary-900 font-medium"
              : "text-muted hover:bg-surface-2 hover:text-foreground"
          )}
        >
          <Smartphone className="size-4 shrink-0" />
          Télécharger l’app
        </Link>
        <Link
          href="/aide"
          className="text-muted hover:bg-surface-2 hover:text-foreground flex w-full items-center gap-3 rounded-[10px] px-3 py-2 text-sm transition-colors"
        >
          <HelpCircle className="size-4 shrink-0" />
          Aide &amp; support
        </Link>
      </div>
    </aside>
  );
}
