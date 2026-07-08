"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Bell, CheckCircle2, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAdminAlerts } from "@/components/admin/admin-alerts-provider";
import {
  DOMAIN_LABEL,
  SEVERITY_DOT_CLASS,
  SEVERITY_LABEL,
  SEVERITY_RANK,
  alertFocusHref,
  maxSeverity,
  sortAlerts,
  summarizeByDomain,
  totalCount,
  type AlertDomain,
} from "@/lib/alerts/alert-model";

/** « il y a 3 h », « il y a 2 j »… à partir d'un ISO (ou null). */
function ago(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return null;
  const min = Math.round(ms / 60_000);
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h} h`;
  const j = Math.round(h / 24);
  return `il y a ${j} j`;
}

/**
 * CENTRE DE NOTIFICATIONS super-admin (cloche du header). Liste toutes les
 * alertes du moteur (mig 0274) groupées par domaine, triées par priorité, chaque
 * ligne = lien profond vers la liste filtrée. Le badge de la cloche porte le
 * TOTAL actionnable, coloré par la gravité MAX (rouge clignotant si urgent).
 */
export function AdminNotificationCenter() {
  const { alerts, isFetching } = useAdminAlerts();
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);

  const total = totalCount(alerts);
  const overall = maxSeverity(alerts);
  const byDomain = summarizeByDomain(alerts);
  const domains = (Object.keys(byDomain) as AlertDomain[]).sort(
    (a, b) =>
      SEVERITY_RANK[byDomain[b].severity] - SEVERITY_RANK[byDomain[a].severity]
  );

  // Fermer au clic extérieur + Échap.
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && setOpen(false);
    document.addEventListener("mousedown", onClick);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onClick);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-label={`Notifications${total > 0 ? ` (${total})` : ""}`}
        aria-expanded={open}
        className="text-muted hover:bg-surface-2 hover:text-foreground relative flex size-9 items-center justify-center rounded-[10px] transition-colors"
      >
        <Bell className="size-5" />
        {total > 0 && (
          <span
            className={cn(
              "absolute -top-0.5 -right-0.5 inline-flex min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-extrabold text-white tabular-nums",
              overall === "critical"
                ? "bg-danger-500 animate-pulse"
                : overall === "warning"
                  ? "bg-warning-500"
                  : "bg-primary-500"
            )}
          >
            {total > 99 ? "99+" : total}
          </span>
        )}
      </button>

      {open && (
        <div className="border-border absolute right-0 z-50 mt-2 max-h-[70vh] w-[min(92vw,22rem)] overflow-y-auto rounded-[14px] border bg-white shadow-xl">
          <div className="border-border bg-surface-2 sticky top-0 flex items-center justify-between border-b px-4 py-2.5">
            <span className="text-foreground text-sm font-bold">
              Alertes & notifications
            </span>
            <span className="text-muted text-xs tabular-nums">
              {isFetching ? "…" : `${total} en cours`}
            </span>
          </div>

          {domains.length === 0 ? (
            <div className="px-4 py-10 text-center">
              <CheckCircle2 className="text-success-500 mx-auto size-9" />
              <p className="text-foreground mt-2 text-sm font-semibold">
                Tout est sous contrôle 🎉
              </p>
              <p className="text-muted mt-0.5 text-xs">
                Aucune alerte sur les domaines.
              </p>
            </div>
          ) : (
            <ul className="divide-border divide-y">
              {domains.map((dom) => (
                <li key={dom} className="px-2 py-2">
                  <p className="text-muted px-2 pb-1 text-[11px] font-bold tracking-wide uppercase">
                    {DOMAIN_LABEL[dom]}
                  </p>
                  <ul className="space-y-0.5">
                    {sortAlerts(byDomain[dom].alerts).map((a) => (
                      <li key={a.code}>
                        <Link
                          href={alertFocusHref(a)}
                          onClick={() => setOpen(false)}
                          className="hover:bg-surface-2 flex items-center gap-2.5 rounded-[10px] px-2 py-2"
                        >
                          <span
                            className={cn(
                              "mt-0.5 size-2 shrink-0 rounded-full",
                              SEVERITY_DOT_CLASS[a.severity]
                            )}
                          />
                          <span className="min-w-0 flex-1">
                            <span className="text-foreground block truncate text-sm font-medium">
                              {a.label}
                            </span>
                            <span className="text-muted block text-xs">
                              {SEVERITY_LABEL[a.severity]}
                              {ago(a.since) ? ` · ${ago(a.since)}` : ""}
                            </span>
                          </span>
                          <span className="text-foreground shrink-0 text-sm font-bold tabular-nums">
                            {a.count}
                          </span>
                          <ChevronRight className="text-muted size-4 shrink-0" />
                        </Link>
                      </li>
                    ))}
                  </ul>
                </li>
              ))}
            </ul>
          )}

          <div className="border-border bg-surface-2 sticky bottom-0 border-t px-2 py-1.5">
            <Link
              href="/admin/alertes"
              onClick={() => setOpen(false)}
              className="text-primary-700 hover:bg-surface block rounded-[10px] px-2 py-1.5 text-center text-sm font-semibold"
            >
              Voir le centre d&apos;alertes
            </Link>
          </div>
        </div>
      )}
    </div>
  );
}
