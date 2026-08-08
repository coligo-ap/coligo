"use client";

import { useState } from "react";
import Link from "next/link";
import {
  AlertTriangle,
  ArrowRight,
  Bell,
  CheckCircle2,
  ListFilter,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useAdminAlerts } from "@/components/admin/admin-alerts-provider";
import {
  DOMAIN_LABEL,
  SEVERITY_BADGE_CLASS,
  SEVERITY_DOT_CLASS,
  SEVERITY_LABEL,
  SEVERITY_RANK,
  alertFocusHref,
  sortAlerts,
  summarizeByDomain,
  type AlertDomain,
  type AlertSeverity,
} from "@/lib/alerts/alert-model";
import { AdminLateOrdersView } from "@/components/admin/admin-late-orders-view";
import type { AdminLateOrder } from "@/lib/data/platform";

/** « il y a 3 h », « il y a 2 j »… */
function ago(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0) return null;
  const min = Math.round(ms / 60_000);
  if (min < 60) return `il y a ${min} min`;
  const h = Math.round(min / 60);
  if (h < 24) return `il y a ${h} h`;
  return `il y a ${Math.round(h / 24)} j`;
}

const SEVERITY_ORDER: Exclude<AlertSeverity, "ok">[] = [
  "critical",
  "warning",
  "info",
];

/**
 * CENTRE D'ALERTES super-admin plein écran. Lit les alertes LIVE du moteur
 * (mig 0274) via le provider TanStack → se rafraîchit tout seul. Filtre par
 * domaine. Le détail riche des commandes en retard (domaine Pilotage) est
 * conservé en drill-down via `AdminLateOrdersView`.
 */
export function AdminAlertCenterView({
  lateOrders,
  thresholdMin,
  initialDomain,
}: {
  lateOrders: AdminLateOrder[];
  thresholdMin: number;
  initialDomain: AlertDomain | null;
}) {
  const { alerts } = useAdminAlerts();
  const [domain, setDomain] = useState<AlertDomain | null>(initialDomain);

  const byDomain = summarizeByDomain(alerts);
  const presentDomains = (Object.keys(byDomain) as AlertDomain[]).sort(
    (a, b) =>
      SEVERITY_RANK[byDomain[b].severity] - SEVERITY_RANK[byDomain[a].severity]
  );

  const shown = domain ? alerts.filter((a) => a.domain === domain) : alerts;
  const visible = sortAlerts(shown);

  const counts = SEVERITY_ORDER.map((s) => ({
    s,
    n: alerts
      .filter((a) => a.severity === s)
      .reduce((acc, a) => acc + a.count, 0),
  })).filter((x) => x.n > 0);

  const showLate = domain === null || domain === "pilotage";

  return (
    <div className="mx-auto max-w-5xl px-4 py-6 lg:px-6">
      <header className="mb-5">
        <h1 className="text-foreground flex items-center gap-2 text-xl font-bold">
          <Bell className="text-primary-600 size-5" />
          Centre d&apos;alertes
        </h1>
        <p className="text-muted mt-1 text-sm">
          Toutes les alertes de la plateforme, par domaine et par priorité.
          Rafraîchies automatiquement.
        </p>
        {/* Synthèse par gravité */}
        {counts.length > 0 && (
          <div className="mt-3 flex flex-wrap gap-2">
            {counts.map(({ s, n }) => (
              <span
                key={s}
                className={cn(
                  "inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold",
                  s === "critical"
                    ? "bg-danger-50 text-danger-700"
                    : s === "warning"
                      ? "bg-warning-50 text-warning-700"
                      : "bg-primary-50 text-primary-700"
                )}
              >
                <span
                  className={cn("size-2 rounded-full", SEVERITY_DOT_CLASS[s])}
                />
                {n} {SEVERITY_LABEL[s].toLowerCase()}
              </span>
            ))}
          </div>
        )}
      </header>

      {/* Filtres par domaine */}
      {presentDomains.length > 0 && (
        <div className="mb-5 flex flex-wrap items-center gap-1.5">
          <ListFilter className="text-muted size-4" />
          <FilterChip
            label="Tous"
            active={domain === null}
            onClick={() => setDomain(null)}
          />
          {presentDomains.map((d) => (
            <FilterChip
              key={d}
              label={DOMAIN_LABEL[d]}
              severity={byDomain[d].severity}
              count={byDomain[d].count}
              active={domain === d}
              onClick={() => setDomain(d)}
            />
          ))}
        </div>
      )}

      {/* Cartes d'alerte */}
      {visible.length === 0 ? (
        <div className="border-border bg-surface rounded-lg border p-10 text-center">
          <CheckCircle2 className="text-success-500 mx-auto size-10" />
          <p className="text-foreground mt-3 text-sm font-semibold">
            Aucune alerte 🎉
          </p>
          <p className="text-muted mt-1 text-xs">
            Rien à traiter sur ce périmètre.
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2">
          {visible.map((a) => (
            <Link
              key={a.code}
              href={alertFocusHref(a)}
              className={cn(
                "bg-surface group rounded-lg border-l-4 p-4 transition-shadow",
                a.severity === "critical"
                  ? "border-danger-400"
                  : a.severity === "warning"
                    ? "border-warning-400"
                    : "border-primary-400"
              )}
            >
              <div className="flex items-start justify-between gap-2">
                <span
                  className={cn(
                    "text-caption inline-flex items-center gap-1 rounded-full px-2 py-0.5 font-bold",
                    SEVERITY_BADGE_CLASS[a.severity]
                  )}
                >
                  {a.severity === "critical" && (
                    <AlertTriangle className="size-3" />
                  )}
                  {SEVERITY_LABEL[a.severity]}
                </span>
                <span className="text-foreground text-2xl font-extrabold tabular-nums">
                  {a.count}
                </span>
              </div>
              <p className="text-foreground mt-2 text-sm font-semibold">
                {a.label}
              </p>
              <div className="text-muted mt-1 flex items-center justify-between text-xs">
                <span>{DOMAIN_LABEL[a.domain]}</span>
                {ago(a.since) && <span>{ago(a.since)}</span>}
              </div>
              <span className="text-primary-700 mt-2 inline-flex items-center gap-1 text-xs font-semibold">
                Traiter
                <ArrowRight className="size-3.5 transition-transform group-hover:translate-x-0.5" />
              </span>
            </Link>
          ))}
        </div>
      )}

      {/* Drill-down Pilotage : détail riche des commandes en retard — cible
          des alertes retards/non acceptées (?focus=…). */}
      {showLate && lateOrders.length > 0 && (
        <section
          data-alert-focus="orders_late_crit orders_late_warn orders_stuck_pending"
          className="border-border mt-8 rounded-lg border-t pt-2"
        >
          <AdminLateOrdersView
            orders={lateOrders}
            thresholdMin={thresholdMin}
          />
        </section>
      )}
    </div>
  );
}

function FilterChip({
  label,
  severity,
  count,
  active,
  onClick,
}: {
  label: string;
  severity?: AlertSeverity;
  count?: number;
  active: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        "inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-semibold transition-colors",
        active
          ? "border-primary-300 bg-primary-50 text-primary-700"
          : "border-border text-muted hover:bg-surface-2 hover:text-foreground"
      )}
    >
      {severity && (
        <span
          className={cn("size-2 rounded-full", SEVERITY_DOT_CLASS[severity])}
        />
      )}
      {label}
      {count != null && <span className="tabular-nums">{count}</span>}
    </button>
  );
}
