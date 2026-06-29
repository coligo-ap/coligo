"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { AlertTriangle, LayoutDashboard, Receipt } from "lucide-react";
import { cn } from "@/lib/utils";

// Onglets du hub Pilotage (cockpit). Le badge Alertes reflète les commandes en
// retard (lateCount fourni par le layout serveur).
export function PilotageHubTabs({ lateCount }: { lateCount: number }) {
  const pathname = usePathname();
  const isActive = (href: string, exact?: boolean) =>
    exact ? pathname === href : pathname.startsWith(href);

  const TABS = [
    {
      href: "/admin",
      label: "Vue d'ensemble",
      icon: LayoutDashboard,
      exact: true,
    },
    { href: "/admin/orders", label: "Commandes", icon: Receipt },
    {
      href: "/admin/alertes",
      label: "Alertes",
      icon: AlertTriangle,
      badge: lateCount,
      danger: true,
    },
  ] as const;

  return (
    <nav className="scrollbar-hide -mx-1 flex items-center gap-1 overflow-x-auto px-1 text-sm">
      {TABS.map((t) => {
        const Icon = t.icon;
        const active = isActive(t.href, "exact" in t ? t.exact : false);
        const danger = "danger" in t && t.danger;
        const badge = "badge" in t ? t.badge : 0;
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              "relative inline-flex shrink-0 items-center gap-1.5 rounded-[10px] px-3 py-1.5 font-medium transition-colors",
              active
                ? danger
                  ? "bg-danger-50 text-danger-700"
                  : "bg-primary-50 text-primary-700"
                : danger && badge > 0
                  ? "text-danger-700 hover:bg-danger-50"
                  : "text-muted hover:bg-surface-2 hover:text-foreground"
            )}
          >
            <Icon className="size-4" />
            {t.label}
            {badge > 0 && (
              <span className="bg-danger-500 inline-flex min-w-[18px] animate-pulse items-center justify-center rounded-full px-1 text-[10px] font-extrabold text-white tabular-nums">
                {badge}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
