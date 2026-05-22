"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  ShoppingBag,
  QrCode,
  Package,
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
  { href: "/orders", label: "Commandes", icon: ShoppingBag },
  { href: "/catalog", label: "Catalogue", icon: Package },
  { href: "/orders/validate", label: "Valider", icon: QrCode },
  { href: "/settings", label: "Réglages", icon: Settings, disabled: true },
];

export function MerchantMobileBottomNav() {
  const pathname = usePathname();

  return (
    <nav
      className="border-border fixed inset-x-0 bottom-0 z-30 border-t bg-white lg:hidden"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <div className="grid h-16 grid-cols-5">
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
