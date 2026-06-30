"use client";

import Link from "next/link";
import { AlertTriangle, Bell } from "lucide-react";
import { cn } from "@/lib/utils";
import { useAdminAlerts } from "@/components/admin/admin-alerts-provider";
import {
  SEVERITY_DOT_CLASS,
  SEVERITY_LABEL,
  maxSeverity,
  sortAlerts,
  type AlertDomain,
} from "@/lib/alerts/alert-model";

/** « il y a 3 h » / « il y a 2 j ». */
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

/**
 * BANDEAU CONTEXTUEL d'un domaine : affiché EN HAUT des pages du domaine pour
 * que l'alerte se retrouve LÀ OÙ elle se traite (pas seulement dans le drawer /
 * la cloche). Chaque alerte = une puce cliquable (gravité + libellé du CAS +
 * compteur + ancienneté) qui pointe vers le SOUS-ÉCRAN exact (href profond).
 * Ne rend rien si le domaine courant n'a aucune alerte.
 */
export function DomainAlertBanner({ domain }: { domain: AlertDomain }) {
  const { alerts } = useAdminAlerts();
  const mine = sortAlerts(alerts.filter((a) => a.domain === domain));
  if (mine.length === 0) return null;

  const sev = maxSeverity(mine);
  const total = mine.reduce((n, a) => n + a.count, 0);

  return (
    <div
      role="status"
      className={cn(
        "border-b px-4 py-2.5 lg:px-6",
        sev === "critical"
          ? "border-danger-200 bg-danger-50"
          : sev === "warning"
            ? "border-warning-200 bg-warning-50"
            : "border-primary-200 bg-primary-50"
      )}
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center gap-x-3 gap-y-2">
        <span
          className={cn(
            "inline-flex items-center gap-1.5 text-sm font-bold",
            sev === "critical"
              ? "text-danger-700"
              : sev === "warning"
                ? "text-warning-700"
                : "text-primary-700"
          )}
        >
          {sev === "critical" ? (
            <AlertTriangle className="size-4" />
          ) : (
            <Bell className="size-4" />
          )}
          {total} alerte{total > 1 ? "s" : ""} dans ce domaine
        </span>

        <div className="flex flex-wrap items-center gap-1.5">
          {mine.map((a) => (
            <Link
              key={a.code}
              href={a.href}
              title={ago(a.since) ? `${a.label} — ${ago(a.since)}` : a.label}
              className="border-border hover:bg-surface inline-flex items-center gap-1.5 rounded-full border bg-white/70 px-2.5 py-1 text-xs font-semibold transition-colors"
            >
              <span
                className={cn(
                  "size-2 rounded-full",
                  SEVERITY_DOT_CLASS[a.severity]
                )}
              />
              <span className="text-foreground">{a.label}</span>
              <span className="text-muted tabular-nums">{a.count}</span>
              <span className="sr-only">{SEVERITY_LABEL[a.severity]}</span>
            </Link>
          ))}
        </div>
      </div>
    </div>
  );
}
