"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  AlertTriangle,
  Bike,
  LayoutDashboard,
  Percent,
  ShieldCheck,
  Store,
  Truck,
} from "lucide-react";
import { cn } from "@/lib/utils";

const LINKS = [
  {
    href: "/admin",
    label: "Tableau de bord",
    icon: LayoutDashboard,
    exact: true,
  },
  { href: "/admin/merchants", label: "Commerçants", icon: Store },
  { href: "/admin/drivers", label: "Livreurs", icon: Truck },
  { href: "/admin/livraison", label: "Livraison", icon: Bike },
  { href: "/admin/settings", label: "Taux", icon: Percent },
  { href: "/admin/security", label: "Sécurité", icon: ShieldCheck },
] as const;

export function AdminNav({ lateCount }: { lateCount: number }) {
  const pathname = usePathname();
  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname.startsWith(href);

  return (
    <nav className="scrollbar-hide flex items-center gap-1 overflow-x-auto text-sm">
      {LINKS.map((l) => {
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
