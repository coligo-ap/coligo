"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Menu, ShieldCheck, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  ADMIN_DOMAINS,
  isAdminDomainActive,
} from "@/components/admin/admin-nav";
import { APP_CONFIG } from "@/lib/config/app-config";

/**
 * Navigation super-admin sur MOBILE : un bouton hamburger ouvre un drawer
 * coulissant (depuis la gauche) avec toutes les sections. La barre horizontale
 * (AdminNav) est masquée sous `lg`. Self-contained : le bouton ET le panneau
 * sont dans ce composant (état local), pas de store global à câbler.
 */
export function AdminMobileNav({
  lateCount,
  payoutsCount = 0,
  merchantPendingCount = 0,
}: {
  lateCount: number;
  payoutsCount?: number;
  merchantPendingCount?: number;
}) {
  const pathname = usePathname();
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  // Anim slide-in fiable même sur WebView : monter en `-translate-x-full` puis
  // basculer à `translate-x-0` au rAF suivant ; à la fermeture, démonter après
  // la transition (un `fixed` hors-écran reste hit-testable sur certains WebView).
  const [mounted, setMounted] = useState(false);
  const [slidIn, setSlidIn] = useState(false);
  useEffect(() => {
    if (open) {
      setMounted(true);
      const id = requestAnimationFrame(() => setSlidIn(true));
      return () => cancelAnimationFrame(id);
    }
    setSlidIn(false);
    const id = window.setTimeout(() => setMounted(false), 220);
    return () => window.clearTimeout(id);
  }, [open]);

  // Échap pour fermer + blocage du scroll de page + focus sur X.
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    closeRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = previousOverflow;
    };
  }, [open]);

  return (
    <>
      {/* Hamburger — MOBILE uniquement. Pastille rouge si alertes en retard. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Ouvrir le menu"
        className="text-muted hover:bg-surface-2 hover:text-foreground relative -ml-1 flex size-10 shrink-0 items-center justify-center rounded-[10px] lg:hidden"
      >
        <Menu className="size-5" />
        {lateCount > 0 ? (
          <span className="bg-danger-500 absolute top-1.5 right-1.5 size-2 rounded-full" />
        ) : payoutsCount > 0 || merchantPendingCount > 0 ? (
          <span className="bg-warning-500 absolute top-1.5 right-1.5 size-2 rounded-full" />
        ) : null}
      </button>

      {mounted && (
        <div className="lg:hidden">
          {/* Overlay sombre */}
          <div
            onClick={() => setOpen(false)}
            aria-hidden="true"
            className={cn(
              "fixed inset-0 z-40 bg-black/40 transition-opacity duration-200",
              slidIn ? "opacity-100" : "opacity-0"
            )}
          />

          {/* Panneau coulissant — depuis la GAUCHE */}
          <aside
            role="dialog"
            aria-modal="true"
            aria-label="Menu d'administration"
            className={cn(
              "fixed inset-y-0 left-0 z-50 flex w-[82%] max-w-xs flex-col bg-white shadow-xl transition-transform duration-200 ease-out",
              slidIn ? "translate-x-0" : "-translate-x-full"
            )}
          >
            <div className="border-border flex items-center justify-between gap-3 border-b p-4">
              <span className="flex min-w-0 items-center gap-2 font-semibold">
                <ShieldCheck className="text-primary-600 size-5 shrink-0" />
                <span className="truncate">{APP_CONFIG.name} Admin</span>
              </span>
              <button
                ref={closeRef}
                type="button"
                onClick={() => setOpen(false)}
                aria-label="Fermer le menu"
                className="text-muted hover:bg-surface-2 hover:text-foreground flex size-10 shrink-0 items-center justify-center rounded-full"
              >
                <X className="size-5" />
              </button>
            </div>

            <nav className="flex-1 space-y-0.5 overflow-y-auto p-3">
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
                    onClick={() => setOpen(false)}
                    className={cn(
                      "flex min-h-[44px] items-center gap-3 rounded-[10px] px-3 py-2 text-sm transition-colors",
                      active
                        ? danger
                          ? "bg-danger-50 text-danger-700 font-medium"
                          : "bg-primary-50 text-primary-900 font-medium"
                        : danger && count > 0
                          ? "text-danger-700 hover:bg-danger-50"
                          : "text-muted hover:bg-surface-2 hover:text-foreground"
                    )}
                  >
                    <Icon className="size-5 shrink-0" />
                    <span className="flex-1">{d.label}</span>
                    {count > 0 && (
                      <span
                        className={cn(
                          "inline-flex min-w-[20px] items-center justify-center rounded-full px-1.5 text-[11px] font-extrabold text-white tabular-nums",
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
          </aside>
        </div>
      )}
    </>
  );
}
