"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { cn } from "@/lib/utils";
import { domainOf, isItemActive } from "@/lib/admin/navigation";
import type { AlertDomain } from "@/lib/alerts/alert-model";

// =============================================================================
// ONGLETS d'un hub — DÉRIVÉS du plan unique (lib/admin/navigation.ts).
//
// Avant, chaque hub portait sa propre liste d'onglets, codée à la main : huit
// listes à tenir à jour, huit occasions d'oublier une page. Elles disaient déjà
// des choses différentes du tiroir. Ici, un seul composant les rend toutes, à
// partir de la MÊME description — et les sections du plan deviennent des
// séparateurs visuels entre groupes d'onglets.
//
// `pendingCount` : compteur « à traiter » du domaine (inscriptions en attente),
// posé sur l'onglet marqué `pending` dans le plan.
// =============================================================================

export function AdminHubTabs({
  domain,
  pendingCount = 0,
  isOwner = true,
}: {
  domain: AlertDomain;
  pendingCount?: number;
  /** Certaines pages (gestion de l'équipe) ne concernent que le propriétaire. */
  isOwner?: boolean;
}) {
  const pathname = usePathname();
  const d = domainOf(domain);
  if (!d) return null;

  return (
    <nav className="scrollbar-hide -mx-1 flex items-center gap-1 overflow-x-auto px-1 text-sm">
      {d.sections.map((section, si) => {
        const items = section.items.filter((i) => isOwner || !i.ownerOnly);
        if (items.length === 0) return null;
        return (
          <div key={section.label ?? si} className="flex items-center gap-1">
            {si > 0 && (
              <span
                aria-hidden
                className="bg-border mx-1 h-4 w-px shrink-0 rounded-full"
              />
            )}
            {items.map((item) => {
              const Icon = item.icon;
              const active = isItemActive(pathname, item);
              const count = item.pending ? pendingCount : 0;
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  title={
                    section.label
                      ? `${section.label} · ${item.label}`
                      : item.label
                  }
                  className={cn(
                    "inline-flex shrink-0 items-center gap-1.5 rounded-[10px] px-3 py-1.5 font-medium transition-colors",
                    active
                      ? "bg-primary-50 text-primary-700"
                      : "text-muted hover:bg-surface-2 hover:text-foreground"
                  )}
                >
                  <Icon className="size-4" />
                  {item.label}
                  {count > 0 && (
                    <span className="bg-warning-500 inline-flex min-w-[18px] animate-pulse items-center justify-center rounded-full px-1 text-[10px] font-extrabold text-white tabular-nums">
                      {count}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        );
      })}
    </nav>
  );
}
