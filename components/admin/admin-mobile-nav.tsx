"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import { Menu, ShieldCheck, X } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  isAdminDomainActive,
  visibleDomains,
  type AdminDomain,
} from "@/components/admin/admin-nav";
import type { AlertDomain } from "@/lib/alerts/alert-model";
import {
  DomainBadge,
  useDomainSummary,
} from "@/components/admin/admin-domain-badge";
import { useAdminAlerts } from "@/components/admin/admin-alerts-provider";
import { maxSeverity, SEVERITY_DOT_CLASS } from "@/lib/alerts/alert-model";
import { APP_CONFIG } from "@/lib/config/app-config";

/**
 * Navigation super-admin sur MOBILE : un bouton hamburger ouvre un drawer
 * coulissant (depuis la gauche) avec toutes les sections. Les badges de gravité
 * par domaine + la pastille du hamburger sont DÉRIVÉS du moteur d'alertes
 * (mig 0274). Self-contained : bouton ET panneau dans ce composant.
 */
export function AdminMobileNav({
  domains,
  isOwner,
}: {
  domains: AlertDomain[];
  isOwner: boolean;
}) {
  const pathname = usePathname();
  const { alerts } = useAdminAlerts();
  const items = visibleDomains(domains, isOwner);
  const [open, setOpen] = useState(false);
  const closeRef = useRef<HTMLButtonElement>(null);

  const overall = maxSeverity(alerts);

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
      {/* Hamburger — MOBILE uniquement. Pastille colorée selon la gravité max. */}
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label="Ouvrir le menu"
        className="text-muted hover:bg-surface-2 hover:text-foreground relative -ml-1 flex size-10 shrink-0 items-center justify-center rounded-[10px] lg:hidden"
      >
        <Menu className="size-5" />
        {overall !== "ok" && (
          <span
            className={cn(
              "absolute top-1.5 right-1.5 size-2 rounded-full",
              SEVERITY_DOT_CLASS[overall]
            )}
          />
        )}
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
            {/* Panneau inset-y-0 : l'en-tête du drawer descend SOUS la barre de
                statut (padding-top = inset), sinon le titre est recouvert. */}
            <div className="border-border flex items-center justify-between gap-3 border-b p-4 pt-[calc(env(safe-area-inset-top)+1rem)]">
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

            {/* RÈGLE safe-area : panneau fixed inset-y-0 → le dernier item ne doit
                jamais finir DERRIÈRE la barre système du bas. */}
            <nav className="flex-1 space-y-0.5 overflow-y-auto p-3 pb-[calc(env(safe-area-inset-bottom)+0.75rem)]">
              {items.map((d) => (
                <MobileItem
                  key={d.href}
                  d={d}
                  active={isAdminDomainActive(pathname, d)}
                  onNavigate={() => setOpen(false)}
                />
              ))}
            </nav>
          </aside>
        </div>
      )}
    </>
  );
}

function MobileItem({
  d,
  active,
  onNavigate,
}: {
  d: AdminDomain;
  active: boolean;
  onNavigate: () => void;
}) {
  const Icon = d.icon;
  const summary = useDomainSummary(d.domain);
  const critical = summary?.severity === "critical";
  return (
    <Link
      href={d.href}
      onClick={onNavigate}
      className={cn(
        "flex min-h-[44px] items-center gap-3 rounded-[10px] px-3 py-2 text-sm transition-colors",
        active
          ? critical
            ? "bg-danger-50 text-danger-700 font-medium"
            : "bg-primary-50 text-primary-900 font-medium"
          : critical
            ? "text-danger-700 hover:bg-danger-50"
            : "text-muted hover:bg-surface-2 hover:text-foreground"
      )}
    >
      <Icon className="size-5 shrink-0" />
      <span className="flex-1">{d.label}</span>
      <DomainBadge summary={summary} />
    </Link>
  );
}
