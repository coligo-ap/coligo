"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ChevronDown, PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  isAdminDomainActive,
  visibleDomains,
  type AdminDomain,
} from "./admin-nav";
import { isItemActive } from "@/lib/admin/navigation";
import { AdminSearchButton } from "@/components/admin/admin-search";
import type { AlertDomain } from "@/lib/alerts/alert-model";
import {
  DomainBadge,
  useDomainSummary,
} from "@/components/admin/admin-domain-badge";
import { AdminContextualAlerts } from "@/components/admin/admin-contextual-alerts";

const KEY = "coligo_admin_sidebar_open";

/**
 * DRAWER DESKTOP du super-admin : barre latérale repliable (256 px ↔ 64 px,
 * état persisté), à DEUX NIVEAUX — domaine, puis ses sections et ses pages.
 *
 * Le drawer ne listait que les 8 domaines : pour découvrir « Pass Prioritaire »
 * ou « Codes-barres », il fallait déjà être entré dans le bon hub et lire ses
 * onglets. Une fonctionnalité qu'on ne voit pas n'existe pas. Le domaine courant
 * est donc DÉPLIÉ, et les autres se déplient d'un clic — l'arborescence entière
 * est atteignable sans deviner.
 *
 * Le contenu vient du plan unique (lib/admin/navigation.ts) ; le badge de
 * gravité par domaine est dérivé du moteur d'alertes (mig 0274).
 */
export function AdminShell({
  children,
  domains,
  isOwner,
}: {
  children: React.ReactNode;
  /** Domaines autorisés de la session (filtre la nav). */
  domains: AlertDomain[];
  isOwner: boolean;
}) {
  const pathname = usePathname();
  const items = visibleDomains(domains, isOwner);
  const [open, setOpen] = useState(true);
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => {
    setOpen(localStorage.getItem(KEY) !== "0");
    setHydrated(true);
  }, []);
  const toggle = () => {
    setOpen((o) => {
      localStorage.setItem(KEY, o ? "0" : "1");
      return !o;
    });
  };

  const item = (d: AdminDomain) => (
    <SidebarGroup
      key={d.href}
      d={d}
      open={open}
      pathname={pathname}
      active={isAdminDomainActive(pathname, d)}
    />
  );

  return (
    <div className="flex">
      {/* Drawer desktop (replié = icônes seules) */}
      <aside
        className={cn(
          // Offsets alignés sur l'en-tête (3.5rem + inset haut) : corrects
          // aussi en APK edge-to-edge (tablette paysage) où l'inset n'est pas 0.
          "border-border sticky top-[calc(3.5rem+env(safe-area-inset-top))] hidden h-[calc(100dvh-3.5rem-env(safe-area-inset-top))] shrink-0 flex-col gap-0.5 overflow-y-auto border-r bg-white p-2 transition-[width] duration-200 lg:flex",
          open ? "w-60" : "w-16",
          !hydrated && "transition-none"
        )}
      >
        <button
          type="button"
          onClick={toggle}
          aria-label={open ? "Replier le menu" : "Déplier le menu"}
          className={cn(
            "text-muted hover:bg-surface-2 hover:text-foreground rounded-control mb-1 flex items-center gap-2.5 px-3 py-2 text-sm font-medium",
            !open && "justify-center px-0"
          )}
        >
          {open ? (
            <>
              <PanelLeftClose className="size-4 shrink-0" />
              <span>Replier</span>
            </>
          ) : (
            <PanelLeftOpen className="size-4 shrink-0" />
          )}
        </button>
        {open && <AdminSearchButton />}
        {items.map((d) => item(d))}
      </aside>
      <div className="min-w-0 flex-1">
        <AdminContextualAlerts />
        {children}
      </div>
    </div>
  );
}

function SidebarGroup({
  d,
  open,
  active,
  pathname,
}: {
  d: AdminDomain;
  open: boolean;
  active: boolean;
  pathname: string;
}) {
  const Icon = d.icon;
  const summary = useDomainSummary(d.key);
  const critical = summary?.severity === "critical";
  // Le domaine courant s'ouvre tout seul ; les autres restent pliés jusqu'au
  // clic. On ne déplie pas les huit d'un coup : ce serait un mur.
  const [expanded, setExpanded] = useState(active);
  useEffect(() => setExpanded(active), [active]);

  const pages = d.sections.flatMap((s) => s.items);
  const showChildren = open && expanded && pages.length > 1;

  return (
    <div>
      <div
        className={cn(
          "rounded-control relative flex items-center transition-colors",
          active
            ? critical
              ? "bg-danger-50 text-danger-700"
              : "bg-primary-50 text-primary-700"
            : critical
              ? "text-danger-700 hover:bg-danger-50"
              : "text-muted hover:bg-surface-2 hover:text-foreground"
        )}
      >
        <Link
          href={d.href}
          title={d.label}
          className={cn(
            "flex min-w-0 flex-1 items-center gap-2.5 px-3 py-2 text-sm font-medium",
            !open && "justify-center px-0"
          )}
        >
          <Icon className="size-4 shrink-0" />
          {open && <span className="truncate">{d.label}</span>}
          <DomainBadge summary={summary} absolute={!open} />
        </Link>
        {open && pages.length > 1 && (
          <button
            type="button"
            onClick={() => setExpanded((e) => !e)}
            aria-label={expanded ? `Replier ${d.label}` : `Déplier ${d.label}`}
            aria-expanded={expanded}
            className="hover:bg-surface-2 mr-1 grid size-6 shrink-0 place-items-center rounded-[6px]"
          >
            <ChevronDown
              className={cn(
                "size-3.5 transition-transform",
                expanded && "rotate-180"
              )}
            />
          </button>
        )}
      </div>

      {showChildren && (
        <div className="border-border mt-0.5 mb-1 ml-[19px] border-l pl-2">
          {d.sections.map((section, i) => (
            <div key={section.label ?? i} className="py-0.5">
              {section.label && (
                <p className="text-muted text-micro px-2 pt-1.5 pb-0.5 font-bold tracking-wide uppercase">
                  {section.label}
                </p>
              )}
              {section.items.map((page) => {
                const PageIcon = page.icon;
                const on = isItemActive(pathname, page);
                const inBranch =
                  on ||
                  (page.children ?? []).some((c) => isItemActive(pathname, c));
                return (
                  <div key={page.href}>
                    <Link
                      href={page.href}
                      className={cn(
                        "text-body-sm flex items-center gap-2 rounded-sm px-2 py-1.5 transition-colors",
                        on
                          ? "text-primary-700 bg-primary-50/70 font-semibold"
                          : "text-muted hover:bg-surface-2 hover:text-foreground"
                      )}
                    >
                      <PageIcon className="size-3.5 shrink-0" />
                      <span className="truncate">{page.label}</span>
                    </Link>
                    {/* Sous-pages : visibles quand on est DANS la branche —
                        sinon le tiroir deviendrait une liste de 60 liens. */}
                    {inBranch &&
                      (page.children ?? []).map((child) => {
                        const ChildIcon = child.icon;
                        const childOn = isItemActive(pathname, child);
                        return (
                          <Link
                            key={child.href}
                            href={child.href}
                            className={cn(
                              "text-label-lg ml-3.5 flex items-center gap-2 rounded-sm px-2 py-1.5 transition-colors",
                              childOn
                                ? "text-primary-700 bg-primary-50/70 font-semibold"
                                : "text-muted hover:bg-surface-2 hover:text-foreground"
                            )}
                          >
                            <ChildIcon className="size-3.5 shrink-0" />
                            <span className="truncate">{child.label}</span>
                          </Link>
                        );
                      })}
                  </div>
                );
              })}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
