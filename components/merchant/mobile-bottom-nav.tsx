"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  ShoppingBag,
  Package,
  BarChart3,
  Settings,
} from "lucide-react";
import { cn } from "@/lib/utils";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  disabled?: boolean;
};

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/orders", label: "Commandes", icon: ShoppingBag, disabled: true },
  { href: "/catalog", label: "Catalogue", icon: Package, disabled: true },
  { href: "/stats", label: "Stats", icon: BarChart3, disabled: true },
  { href: "/settings", label: "Réglages", icon: Settings, disabled: true },
];

export function MerchantMobileBottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="lg:hidden fixed bottom-0 inset-x-0 z-30 bg-white border-t border-border"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="grid grid-cols-5 h-16">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = pathname.startsWith(item.href) && !item.disabled;
          const className = cn(
            "flex flex-col items-center justify-center gap-1 text-[10px] font-medium transition-colors",
            active && "text-primary-700",
            !active && !item.disabled && "text-muted",
            item.disabled && "text-border-strong pointer-events-none"
          );

          if (item.disabled) {
            return (
              <div key={item.href} className={className}>
                <Icon className="size-5" />
                <span>{item.label}</span>
              </div>
            );
          }

          return (
            <Link key={item.href} href={item.href} className={className}>
              <Icon className="size-5" />
              <span>{item.label}</span>
            </Link>
          );
        })}
      </div>
    </nav>
  );
}
