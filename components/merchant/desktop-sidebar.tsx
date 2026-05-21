"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  LayoutDashboard,
  Package,
  ShoppingBag,
  BarChart3,
  Wallet,
  Settings,
  HelpCircle,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { Logo } from "@/components/shared/logo";

type NavItem = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: string | number;
  disabled?: boolean;
};

const NAV_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Tableau de bord", icon: LayoutDashboard },
  { href: "/orders", label: "Commandes", icon: ShoppingBag, disabled: true },
  { href: "/catalog", label: "Catalogue", icon: Package, disabled: true },
  { href: "/stats", label: "Statistiques", icon: BarChart3, disabled: true },
  { href: "/finances", label: "Finances", icon: Wallet, disabled: true },
  { href: "/settings", label: "Paramètres", icon: Settings, disabled: true },
];

export function MerchantSidebar({ merchantName }: { merchantName: string }) {
  const pathname = usePathname();

  return (
    <aside className="hidden lg:flex lg:flex-col lg:w-60 lg:fixed lg:inset-y-0 lg:border-r lg:border-border lg:bg-white z-30">
      <div className="px-5 py-5 border-b border-border">
        <Logo variant="amber" size="md" subtitle={merchantName} />
      </div>

      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {NAV_ITEMS.map((item) => {
          const Icon = item.icon;
          const active = pathname.startsWith(item.href);

          if (item.disabled) {
            return (
              <div
                key={item.href}
                className="flex items-center gap-3 px-3 py-2 rounded-[10px] text-sm text-subtle cursor-not-allowed"
                title="Bientôt disponible"
              >
                <Icon className="size-4 shrink-0" />
                <span className="flex-1">{item.label}</span>
                <span className="text-[10px] uppercase tracking-wider text-subtle">
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
                "flex items-center gap-3 px-3 py-2 rounded-[10px] text-sm transition-colors",
                active
                  ? "bg-primary-50 text-primary-900 font-medium"
                  : "text-muted hover:bg-surface-2 hover:text-foreground"
              )}
            >
              <Icon className="size-4 shrink-0" />
              <span className="flex-1">{item.label}</span>
              {item.badge !== undefined && (
                <span className="text-[10px] px-1.5 py-0.5 rounded-full bg-primary-100 text-primary-800 font-semibold tabular-nums">
                  {item.badge}
                </span>
              )}
            </Link>
          );
        })}
      </nav>

      <div className="px-3 py-4 border-t border-border">
        <a
          href="#"
          className="flex items-center gap-3 px-3 py-2 rounded-[10px] text-sm text-muted hover:bg-surface-2 hover:text-foreground transition-colors"
        >
          <HelpCircle className="size-4 shrink-0" />
          Centre d&apos;aide
        </a>
      </div>
    </aside>
  );
}
