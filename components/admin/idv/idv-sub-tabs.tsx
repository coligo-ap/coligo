"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Inbox, SlidersHorizontal } from "lucide-react";
import { cn } from "@/lib/utils";

// Sous-navigation du domaine Identité : pilotage (règles, modes, seuils) et
// file de revue humaine. Deux surfaces distinctes, un seul tap pour passer de
// l'une à l'autre.
const TABS: {
  href: string;
  label: string;
  icon: typeof Inbox;
  /** Actif seulement sur l'URL exacte (sinon le pilotage capterait /dossiers). */
  exact?: boolean;
}[] = [
  {
    href: "/admin/identite",
    label: "Pilotage",
    icon: SlidersHorizontal,
    exact: true,
  },
  {
    href: "/admin/identite/dossiers",
    label: "Dossiers à vérifier",
    icon: Inbox,
  },
];

export function IdvSubTabs({ pendingCount = 0 }: { pendingCount?: number }) {
  const pathname = usePathname();
  return (
    <nav className="scrollbar-hide -mx-1 flex items-center gap-1 overflow-x-auto px-1 pb-1 text-sm">
      {TABS.map((t) => {
        const Icon = t.icon;
        const active = t.exact
          ? pathname === t.href
          : pathname.startsWith(t.href);
        return (
          <Link
            key={t.href}
            href={t.href}
            className={cn(
              "rounded-control inline-flex shrink-0 items-center gap-1.5 px-3 py-1.5 font-medium transition-colors",
              active
                ? "bg-primary-50 text-primary-700"
                : "text-muted hover:bg-surface-2 hover:text-foreground"
            )}
          >
            <Icon className="size-4" />
            {t.label}
            {t.href.endsWith("/dossiers") && pendingCount > 0 && (
              <span className="bg-warning-500 text-micro rounded-full px-1.5 py-0.5 font-bold text-white">
                {pendingCount}
              </span>
            )}
          </Link>
        );
      })}
    </nav>
  );
}
