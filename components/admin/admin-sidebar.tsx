"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  isAdminDomainActive,
  visibleDomains,
  type AdminDomain,
} from "./admin-nav";
import type { AlertDomain } from "@/lib/alerts/alert-model";
import {
  DomainBadge,
  useDomainSummary,
} from "@/components/admin/admin-domain-badge";
import { AdminContextualAlerts } from "@/components/admin/admin-contextual-alerts";

const KEY = "coligo_admin_sidebar_open";

/**
 * DRAWER DESKTOP du super-admin : barre latérale repliable (240px ↔ 64px,
 * état persisté). Navigation regroupée en 8 DOMAINES (chaque domaine = un hub
 * à onglets). Le badge de gravité par domaine est DÉRIVÉ du moteur d'alertes
 * (mig 0274) via `useAdminAlerts` — plus aucun compteur câblé à la main. Sur
 * mobile, la navigation reste le drawer existant (AdminMobileNav).
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
    <SidebarItem
      key={d.href}
      d={d}
      open={open}
      active={isAdminDomainActive(pathname, d)}
    />
  );

  return (
    <div className="flex">
      {/* Drawer desktop (replié = icônes seules) */}
      <aside
        className={cn(
          "border-border sticky top-14 hidden h-[calc(100dvh-56px)] shrink-0 flex-col gap-0.5 overflow-y-auto border-r bg-white p-2 transition-[width] duration-200 lg:flex",
          open ? "w-60" : "w-16",
          !hydrated && "transition-none"
        )}
      >
        <button
          type="button"
          onClick={toggle}
          aria-label={open ? "Replier le menu" : "Déplier le menu"}
          className={cn(
            "text-muted hover:bg-surface-2 hover:text-foreground mb-1 flex items-center gap-2.5 rounded-[10px] px-3 py-2 text-sm font-medium",
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
        {items.map((d) => item(d))}
      </aside>
      <div className="min-w-0 flex-1">
        <AdminContextualAlerts />
        {children}
      </div>
    </div>
  );
}

function SidebarItem({
  d,
  open,
  active,
}: {
  d: AdminDomain;
  open: boolean;
  active: boolean;
}) {
  const Icon = d.icon;
  const summary = useDomainSummary(d.domain);
  const critical = summary?.severity === "critical";
  return (
    <Link
      href={d.href}
      title={d.label}
      className={cn(
        "relative flex items-center gap-2.5 rounded-[10px] px-3 py-2 text-sm font-medium transition-colors",
        !open && "justify-center px-0",
        active
          ? critical
            ? "bg-danger-50 text-danger-700"
            : "bg-primary-50 text-primary-700"
          : critical
            ? "text-danger-700 hover:bg-danger-50"
            : "text-muted hover:bg-surface-2 hover:text-foreground"
      )}
    >
      <Icon className="size-4 shrink-0" />
      {open && <span className="truncate">{d.label}</span>}
      <DomainBadge summary={summary} absolute={!open} />
    </Link>
  );
}
