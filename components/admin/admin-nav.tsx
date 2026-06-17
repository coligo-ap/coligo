"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AlertTriangle,
  BadgeCheck,
  BellRing,
  Bike,
  Car,
  Flag,
  LayoutDashboard,
  MapPinned,
  Megaphone,
  MonitorSmartphone,
  Percent,
  PiggyBank,
  Power,
  Receipt,
  ShieldCheck,
  Store,
  Truck,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";

export const ADMIN_LINKS = [
  {
    href: "/admin",
    label: "Tableau de bord",
    icon: LayoutDashboard,
    exact: true,
  },
  { href: "/admin/controle", label: "Contrôle services", icon: Power },
  { href: "/admin/merchants", label: "Commerçants", icon: Store },
  { href: "/admin/coligo-pay", label: "Coligo Pay", icon: Wallet },
  { href: "/admin/recharges", label: "Recharges", icon: PiggyBank },
  { href: "/admin/agents", label: "Agents Coligo Pay", icon: BadgeCheck },
  { href: "/admin/drivers", label: "Livreurs", icon: Truck },
  { href: "/admin/chauffeurs", label: "Chauffeurs", icon: Car },
  { href: "/admin/drive", label: "Config Drive", icon: Car },
  { href: "/admin/livraison", label: "Livraison", icon: Bike },
  { href: "/admin/zones", label: "Zones", icon: MapPinned },
  { href: "/admin/bannieres", label: "Bannières", icon: Megaphone },
  { href: "/admin/orders", label: "Commandes", icon: Receipt },
  { href: "/admin/reports", label: "Signalements", icon: Flag },
  { href: "/admin/notifications", label: "Notifications", icon: BellRing },
  { href: "/admin/devices", label: "Appareils", icon: MonitorSmartphone },
  { href: "/admin/settings", label: "Taux", icon: Percent },
  { href: "/admin/security", label: "Sécurité", icon: ShieldCheck },
] as const;

export function AdminNav({ lateCount }: { lateCount: number }) {
  const pathname = usePathname();
  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname.startsWith(href);

  return (
    // Barre horizontale : DESKTOP uniquement. Sur mobile → drawer (AdminMobileNav).
    <nav className="scrollbar-hide hidden items-center gap-1 overflow-x-auto text-sm lg:flex">
      {ADMIN_LINKS.map((l) => {
        const Icon = l.icon;
        const active = isActive(l.href, "exact" in l ? l.exact : false);
        return (
          <Link
            key={l.href}
            href={l.href}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-[10px] px-3 py-1.5 font-medium transition-colors",
              active
                ? "bg-primary-50 text-primary-700"
                : "text-muted hover:bg-surface-2 hover:text-foreground"
            )}
          >
            <Icon className="size-4" />
            {l.label}
          </Link>
        );
      })}
      {/* Alertes — avec badge compteur */}
      <Link
        href="/admin/alertes"
        className={cn(
          "relative inline-flex shrink-0 items-center gap-1.5 rounded-[10px] px-3 py-1.5 font-medium transition-colors",
          isActive("/admin/alertes")
            ? "bg-danger-50 text-danger-700"
            : lateCount > 0
              ? "text-danger-700 hover:bg-danger-50"
              : "text-muted hover:bg-surface-2 hover:text-foreground"
        )}
      >
        <AlertTriangle className="size-4" />
        Alertes
        {lateCount > 0 && (
          <span className="bg-danger-500 inline-flex min-w-[18px] animate-pulse items-center justify-center rounded-full px-1 text-[10px] font-extrabold text-white tabular-nums">
            {lateCount}
          </span>
        )}
      </Link>
    </nav>
  );
}
