"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  Bike,
  Car,
  LayoutDashboard,
  Megaphone,
  Settings2,
  ShieldCheck,
  Store,
  Wallet,
} from "lucide-react";
import { cn } from "@/lib/utils";

// =============================================================================
// Navigation super-admin regroupée en 8 DOMAINES fonctionnels (chaque domaine
// est un hub à onglets — la sous-navigation se fait via les onglets du hub).
// `match` = préfixes de routes supplémentaires appartenant au domaine (pour
// l'état actif). `badge` = compteur live affiché sur le domaine.
// =============================================================================

export type AdminDomain = {
  href: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  exact?: boolean;
  match?: string[];
  badge?: "late" | "payouts" | "merchant";
};

export const ADMIN_DOMAINS: AdminDomain[] = [
  {
    href: "/admin",
    label: "Pilotage",
    icon: LayoutDashboard,
    exact: true,
    match: ["/admin/orders", "/admin/alertes"],
    badge: "late",
  },
  {
    href: "/admin/merchants",
    label: "Commerçants",
    icon: Store,
    badge: "merchant",
  },
  {
    href: "/admin/drivers",
    label: "Livraison",
    icon: Bike,
    match: ["/admin/livraison"],
  },
  {
    href: "/admin/chauffeurs",
    label: "Coligo Drive",
    icon: Car,
    match: ["/admin/drive"],
  },
  {
    href: "/admin/coligo-pay",
    label: "Coligo Pay & Finances",
    icon: Wallet,
    match: ["/admin/agents", "/admin/recharges", "/admin/versements"],
    badge: "payouts",
  },
  {
    href: "/admin/marketing",
    label: "Marketing",
    icon: Megaphone,
    match: ["/admin/bannieres", "/admin/notifications"],
  },
  {
    href: "/admin/reports",
    label: "Confiance & Sécurité",
    icon: ShieldCheck,
    match: ["/admin/devices", "/admin/security"],
  },
  {
    href: "/admin/controle",
    label: "Plateforme",
    icon: Settings2,
    match: ["/admin/settings", "/admin/config", "/admin/zones"],
  },
];

/** Un préfixe matche la route s'il est égal ou suivi d'un « / » (évite que
 *  /admin/drive (Drive) capture /admin/drivers (Livraison)). */
function prefixMatches(pathname: string, p: string): boolean {
  return pathname === p || pathname.startsWith(p + "/");
}

export function isAdminDomainActive(pathname: string, d: AdminDomain): boolean {
  const hrefHit = d.exact
    ? pathname === d.href
    : prefixMatches(pathname, d.href);
  if (hrefHit) return true;
  return (d.match ?? []).some((m) => prefixMatches(pathname, m));
}

// Barre horizontale (legacy, conservée). La nav principale = AdminShell (sidebar).
export function AdminNav({
  lateCount,
  payoutsCount = 0,
  merchantPendingCount = 0,
}: {
  lateCount: number;
  payoutsCount?: number;
  merchantPendingCount?: number;
}) {
  const pathname = usePathname();

  return (
    <nav className="scrollbar-hide hidden items-center gap-1 overflow-x-auto text-sm lg:flex">
      {ADMIN_DOMAINS.map((d) => {
        const Icon = d.icon;
        const active = isAdminDomainActive(pathname, d);
        const count =
          d.badge === "late"
            ? lateCount
            : d.badge === "payouts"
              ? payoutsCount
              : d.badge === "merchant"
                ? merchantPendingCount
                : 0;
        const danger = d.badge === "late";
        return (
          <Link
            key={d.href}
            href={d.href}
            className={cn(
              "relative inline-flex shrink-0 items-center gap-1.5 rounded-[10px] px-3 py-1.5 font-medium transition-colors",
              active
                ? danger
                  ? "bg-danger-50 text-danger-700"
                  : "bg-primary-50 text-primary-700"
                : danger && count > 0
                  ? "text-danger-700 hover:bg-danger-50"
                  : "text-muted hover:bg-surface-2 hover:text-foreground"
            )}
          >
            <Icon className="size-4" />
            {d.label}
            {count > 0 && (
              <span
                className={cn(
                  "inline-flex min-w-[18px] animate-pulse items-center justify-center rounded-full px-1 text-[10px] font-extrabold text-white tabular-nums",
                  danger ? "bg-danger-500" : "bg-warning-500"
                )}
              >
                {count}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
