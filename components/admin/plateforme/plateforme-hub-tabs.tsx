"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  MapPinned,
  Percent,
  Power,
  Settings2,
  ShieldPlus,
  Tags,
} from "lucide-react";
import { cn } from "@/lib/utils";

const TABS = [
  { href: "/admin/controle", label: "Contrôle services", icon: Power },
  { href: "/admin/settings", label: "Taux", icon: Percent },
  { href: "/admin/config", label: "Configuration", icon: Settings2 },
  { href: "/admin/zones", label: "Zones", icon: MapPinned },
  { href: "/admin/categories", label: "Catégories", icon: Tags },
] as const;

// L'onglet « Admins » (gestion des super-admins + attribution des domaines) est
// OWNER-ONLY : il n'apparaît que pour un owner (la page elle-même re-gate via
// requireOwner()).
export function PlateformeHubTabs({ isOwner = false }: { isOwner?: boolean }) {
  const pathname = usePathname();
  const tabs = isOwner
    ? [...TABS, { href: "/admin/admins", label: "Admins", icon: ShieldPlus }]
    : TABS;
  return (
    <nav className="scrollbar-hide -mx-1 flex items-center gap-1 overflow-x-auto px-1 text-sm">
      {tabs.map((t) => {
        const Icon = t.icon;
        const active = pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              "inline-flex shrink-0 items-center gap-1.5 rounded-[10px] px-3 py-1.5 font-medium transition-colors",
              active
                ? "bg-primary-50 text-primary-700"
                : "text-muted hover:bg-surface-2 hover:text-foreground"
            )}
          >
            <Icon className="size-4" />
            {t.label}
          </Link>
        );
      })}
    </nav>
  );
}
