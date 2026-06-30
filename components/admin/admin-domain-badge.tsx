"use client";

import { cn } from "@/lib/utils";
import {
  SEVERITY_BADGE_CLASS,
  summarizeByDomain,
  type AlertDomain,
  type DomainAlertSummary,
} from "@/lib/alerts/alert-model";
import { useAdminAlerts } from "@/components/admin/admin-alerts-provider";

/** Synthèse d'alertes (gravité max + total) du domaine, depuis le moteur live. */
export function useDomainSummary(
  domain: AlertDomain
): DomainAlertSummary | null {
  const { alerts } = useAdminAlerts();
  return summarizeByDomain(alerts)[domain] ?? null;
}

/**
 * Badge de gravité d'un domaine pour le drawer : pastille colorée + compteur,
 * clignotante si critique (rouge). `absolute` = variante coin (sidebar repliée).
 * Ne rend rien si le domaine n'a aucune alerte actionnable.
 */
export function DomainBadge({
  summary,
  absolute = false,
}: {
  summary: DomainAlertSummary | null;
  absolute?: boolean;
}) {
  if (!summary || summary.count === 0 || summary.severity === "ok") return null;
  return (
    <span
      aria-label={`${summary.count} alerte${summary.count > 1 ? "s" : ""}`}
      className={cn(
        "inline-flex min-w-[18px] items-center justify-center rounded-full px-1 text-[10px] font-extrabold tabular-nums",
        SEVERITY_BADGE_CLASS[summary.severity],
        absolute && "absolute -top-0.5 -right-0.5"
      )}
    >
      {summary.count}
    </span>
  );
}
