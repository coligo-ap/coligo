// =============================================================================
// Modèle d'alertes super-admin — types + helpers PURS (client-safe)
// =============================================================================
// Ce module ne contient AUCUN import serveur (pas de createClient / next/headers)
// → il peut être importé aussi bien par les composants client (drawer, cloche,
// page) que par la couche données serveur (`lib/data/admin-alerts.ts`).
//
// La vérité des alertes est calculée EN BASE par la RPC `admin_alerts()`
// (mig 0274, gardée is_super_admin). Ici on ne fait que TYPER et PRÉSENTER ce
// que la base renvoie — jamais de logique métier d'alerte côté client.
// =============================================================================

/** Gravité d'une alerte. `ok` = absence d'alerte (le domaine n'en émet aucune). */
export type AlertSeverity = "critical" | "warning" | "info" | "ok";

/** Les 8 domaines fonctionnels du back-office (clés stables côté RPC). */
export type AlertDomain =
  | "pilotage"
  | "commercants"
  | "livraison"
  | "drive"
  | "finances"
  | "confiance"
  | "plateforme"
  | "marketing"
  | "clients";

/** Une alerte émise par la RPC. `severity` n'est jamais `ok` ici (les règles à
 *  0 ne sont pas émises). `since` = plus ancien élément concerné (escalade). */
export type AdminAlert = {
  code: string;
  domain: AlertDomain;
  severity: Exclude<AlertSeverity, "ok">;
  count: number;
  label: string;
  href: string;
  since: string | null;
};

/** Synthèse d'un domaine : gravité MAX + total actionnable + ses alertes. */
export type DomainAlertSummary = {
  severity: AlertSeverity;
  count: number;
  alerts: AdminAlert[];
};

/** Priorité numérique (tri + sévérité max). */
export const SEVERITY_RANK: Record<AlertSeverity, number> = {
  critical: 3,
  warning: 2,
  info: 1,
  ok: 0,
};

/** Libellés FR par gravité (UI). */
export const SEVERITY_LABEL: Record<Exclude<AlertSeverity, "ok">, string> = {
  critical: "Urgent",
  warning: "À surveiller",
  info: "En attente",
};

/**
 * Classes Tailwind du badge/pastille par gravité (tokens du design system).
 *  - critical : rouge + clignotant (animate-pulse) — action immédiate
 *  - warning  : orange — risque
 *  - info     : violet (primary) — en attente non urgent
 *  - ok       : vert — RAS
 */
export const SEVERITY_BADGE_CLASS: Record<AlertSeverity, string> = {
  critical: "bg-danger-500 text-white animate-pulse",
  warning: "bg-warning-500 text-white",
  info: "bg-primary-500 text-white",
  ok: "bg-success-500 text-white",
};

/** Classes d'un point/pastille discret (sans texte) par gravité. */
export const SEVERITY_DOT_CLASS: Record<AlertSeverity, string> = {
  critical: "bg-danger-500 animate-pulse",
  warning: "bg-warning-500",
  info: "bg-primary-500",
  ok: "bg-success-500",
};

/** Libellés FR par domaine (titres de section dans la cloche / la page). */
export const DOMAIN_LABEL: Record<AlertDomain, string> = {
  pilotage: "Pilotage",
  commercants: "Commerçants",
  livraison: "Livraison",
  drive: "Coligo Drive",
  finances: "Coligo Pay & Finances",
  confiance: "Confiance & Sécurité",
  plateforme: "Plateforme",
  marketing: "Marketing",
  clients: "Clients",
};

/**
 * FOCUS FRONTEND — nom du paramètre d'URL ajouté aux liens d'alerte pour que
 * la page d'arrivée mette en SURBRILLANCE CLIGNOTANTE le composant concerné
 * (marqué `data-alert-focus="<codes>"`, cf. `AlertFocusEffect`). Purement
 * visuel : aucun impact données, le href de la RPC reste la vérité.
 */
export const ALERT_FOCUS_PARAM = "focus";

/** Href d'une alerte enrichi du code à surligner sur la page cible. */
export function alertFocusHref(a: AdminAlert): string {
  if (!a.href || a.href === "#") return a.href;
  const sep = a.href.includes("?") ? "&" : "?";
  return `${a.href}${sep}${ALERT_FOCUS_PARAM}=${encodeURIComponent(a.code)}`;
}

/** Gravité la plus forte d'une liste d'alertes (`ok` si vide). */
export function maxSeverity(alerts: AdminAlert[]): AlertSeverity {
  let best: AlertSeverity = "ok";
  for (const a of alerts) {
    if (SEVERITY_RANK[a.severity] > SEVERITY_RANK[best]) best = a.severity;
  }
  return best;
}

/**
 * Regroupe les alertes par domaine → gravité max + total. Réutilisé par le
 * drawer (badge par domaine), la cloche et la page centre d'alertes.
 */
export function summarizeByDomain(
  alerts: AdminAlert[]
): Record<AlertDomain, DomainAlertSummary> {
  const out = {} as Record<AlertDomain, DomainAlertSummary>;
  for (const a of alerts) {
    const s = (out[a.domain] ??= { severity: "ok", count: 0, alerts: [] });
    s.alerts.push(a);
    s.count += a.count;
    if (SEVERITY_RANK[a.severity] > SEVERITY_RANK[s.severity]) {
      s.severity = a.severity;
    }
  }
  return out;
}

/** Total actionnable toutes alertes confondues (badge de la cloche). */
export function totalCount(alerts: AdminAlert[]): number {
  return alerts.reduce((n, a) => n + a.count, 0);
}

/** Tri d'affichage : gravité décroissante puis volume décroissant. */
export function sortAlerts(alerts: AdminAlert[]): AdminAlert[] {
  return [...alerts].sort(
    (a, b) =>
      SEVERITY_RANK[b.severity] - SEVERITY_RANK[a.severity] || b.count - a.count
  );
}
