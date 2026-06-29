"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { PanelLeftClose, PanelLeftOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ADMIN_DOMAINS,
  isAdminDomainActive,
  type AdminDomain,
} from "./admin-nav";

const KEY = "coligo_admin_sidebar_open";

/**
 * DRAWER DESKTOP du super-admin : barre latérale repliable (240px ↔ 64px,
 * état persisté). Navigation regroupée en 8 DOMAINES (chaque domaine = un hub
 * à onglets). Sur mobile, la navigation reste le drawer existant
 * (AdminMobileNav) — la sidebar n'apparaît qu'à partir de lg.
 */
export function AdminShell({
  lateCount,
  payoutsCount = 0,
  merchantPendingCount = 0,
  children,
}: {
  lateCount: number;
  payoutsCount?: number;
  merchantPendingCount?: number;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
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

  const item = (d: AdminDomain) => {
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
        title={d.label}
        className={cn(
          "relative flex items-center gap-2.5 rounded-[10px] px-3 py-2 text-sm font-medium transition-colors",
          !open && "justify-center px-0",
          active
            ? danger
              ? "bg-danger-50 text-danger-700"
              : "bg-primary-50 text-primary-700"
            : danger && count > 0
              ? "text-danger-700 hover:bg-danger-50"
              : "text-muted hover:bg-surface-2 hover:text-foreground"
        )}
      >
        <Icon className="size-4 shrink-0" />
        {open && <span className="truncate">{d.label}</span>}
        {count > 0 && (
          <span
            className={cn(
              "inline-flex min-w-[18px] animate-pulse items-center justify-center rounded-full px-1 text-[10px] font-extrabold text-white tabular-nums",
              danger ? "bg-danger-500" : "bg-warning-500",
              !open && "absolute -top-0.5 -right-0.5"
            )}
          >
            {count}
          </span>
        )}
      </Link>
    );
  };

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
        {ADMIN_DOMAINS.map((d) => item(d))}
      </aside>
      <div className="min-w-0 flex-1">{children}</div>
    </div>
  );
}
