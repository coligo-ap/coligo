/**
 * Modèle anti-fraude — types + helpers PURS, client-safe (aucun import serveur).
 * Miroir des tables/RPC des migrations 0373-0374 (docs/ANTI-FRAUDE.md).
 */

export type FraudActorKind = "customer" | "driver" | "chauffeur" | "merchant";

export const FRAUD_KIND_LABEL: Record<FraudActorKind, string> = {
  customer: "Client",
  driver: "Livreur",
  chauffeur: "Chauffeur",
  merchant: "Commerçant",
};

export const FRAUD_KINDS: FraudActorKind[] = [
  "customer",
  "driver",
  "chauffeur",
  "merchant",
];

/** Gravité d'alerte ET niveau de risque (même échelle 4 crans). */
export type FraudSeverity = "low" | "medium" | "high" | "critical";

export const FRAUD_SEVERITIES: FraudSeverity[] = [
  "critical",
  "high",
  "medium",
  "low",
];

/** Palette de statut VALIDÉE (CVD + contraste, scripts dataviz) — les barres
 *  portent toujours leurs compteurs en clair (l'ambre seul manque de
 *  contraste). */
export const FRAUD_SEVERITY_META: Record<
  FraudSeverity,
  { label: string; badge: string; color: string }
> = {
  low: {
    label: "Faible",
    badge: "bg-blue-50 text-blue-700 border-blue-200",
    color: "#3b82f6",
  },
  medium: {
    label: "Moyenne",
    badge: "bg-amber-50 text-amber-800 border-amber-200",
    color: "#f59e0b",
  },
  high: {
    label: "Élevée",
    badge: "bg-orange-50 text-orange-800 border-orange-200",
    color: "#ea580c",
  },
  critical: {
    label: "Critique",
    badge: "bg-red-50 text-red-700 border-red-200",
    color: "#991b1b",
  },
};

/** Paire catégorielle validée pour Auto vs Équipe (actions par jour). */
export const FRAUD_SOURCE_COLOR = {
  auto: "#6C2BD9",
  admin: "#0d9488",
} as const;

export type FraudActionType =
  | "warn"
  | "require_ack"
  | "limit"
  | "force_offline"
  | "require_idv"
  | "readonly"
  | "suspend"
  | "restore"
  | "note";

export const FRAUD_ACTION_LABEL: Record<FraudActionType, string> = {
  warn: "Avertissement",
  require_ack: "Popup obligatoire",
  limit: "Limitation",
  force_offline: "Hors ligne forcé",
  require_idv: "Vérif. d'identité",
  readonly: "Lecture seule",
  suspend: "Suspension",
  restore: "Rétablissement",
  note: "Note interne",
};

/** Mesures applicables manuellement, dans l'ordre de gravité. */
export const FRAUD_APPLICABLE_ACTIONS: FraudActionType[] = [
  "note",
  "warn",
  "require_ack",
  "limit",
  "force_offline",
  "require_idv",
  "readonly",
  "suspend",
  "restore",
];

export type FraudComponent = {
  rule: string;
  label: string;
  category: string;
  value: number;
  threshold: number;
  points: number;
  weight_mult: number;
  severity: FraudSeverity;
  triggered: boolean;
};

export type FraudScoreRow = {
  actor_kind: FraudActorKind;
  actor_id: string;
  user_id: string | null;
  display_name: string | null;
  trust_score: number;
  fraud_score: number;
  risk_score: number;
  risk_level: FraudSeverity;
  components: FraudComponent[];
  features: Record<string, unknown>;
  suspicious_count: number;
  evaluated_at: string | null;
  updated_at: string;
};

export type FraudAlertRow = {
  id: string;
  actor_kind: FraudActorKind;
  actor_id: string;
  display_name: string | null;
  rule_code: string;
  severity: FraudSeverity;
  title: string;
  evidence: {
    value?: number;
    threshold?: number;
    points?: number;
    risk?: number;
  };
  status: "open" | "investigating" | "confirmed" | "dismissed";
  occurrences: number;
  first_seen_at: string;
  last_seen_at: string;
  reviewed_by_email: string | null;
  reviewed_at: string | null;
  review_note: string | null;
  created_at: string;
};

export const FRAUD_ALERT_STATUS_LABEL: Record<FraudAlertRow["status"], string> =
  {
    open: "À examiner",
    investigating: "Enquête",
    confirmed: "Fraude confirmée",
    dismissed: "Faux positif",
  };

export type FraudActionRow = {
  id: string;
  actor_kind: FraudActorKind;
  actor_id: string;
  action: FraudActionType;
  source: "auto" | "admin";
  admin_email: string | null;
  reason: string;
  meta: Record<string, unknown>;
  created_at: string;
  expires_at: string | null;
  revoked_at: string | null;
  revoked_by_email: string | null;
  revoke_note: string | null;
};

export type FraudRuleRow = {
  code: string;
  actor_kind: FraudActorKind | "all";
  category: string;
  label: string;
  description: string;
  base_weight: number;
  params: Record<string, unknown>;
  severity: FraudSeverity;
  enabled: boolean;
  hits: number;
  confirmed_hits: number;
  dismissed_hits: number;
};

export type FraudSettingRow = { key: string; value: unknown; label: string };

export type FraudOverview = {
  kpis: {
    alerts_open: number;
    alerts_critical: number;
    actions_7d: number;
    auto_offline_24h: number;
    acks_pending: number;
    high_risk: number;
    scored_actors: number;
  };
  alerts_by_day: {
    d: string;
    low: number;
    medium: number;
    high: number;
    critical: number;
  }[];
  actions_by_day: { d: string; auto: number; admin: number }[];
  risk_distribution: {
    kind: FraudActorKind;
    low: number;
    medium: number;
    high: number;
    critical: number;
  }[];
  top_risk: {
    actor_kind: FraudActorKind;
    actor_id: string;
    display_name: string | null;
    trust: number;
    fraud: number;
    risk: number;
    level: FraudSeverity;
    suspicious: number;
  }[];
  rules_learning: {
    code: string;
    label: string;
    hits: number;
    confirmed: number;
    dismissed: number;
    weight_mult: number;
  }[];
};

export type FraudActorDetail = {
  score: FraudScoreRow | null;
  history: {
    at: string;
    trust: number;
    fraud: number;
    risk: number;
    reason: string | null;
  }[];
  alerts: FraudAlertRow[];
  actions: FraudActionRow[];
  events: {
    id: number;
    event_type: string;
    order_id: string | null;
    ride_id: string | null;
    counterparty_kind: string | null;
    lat: number | null;
    lng: number | null;
    meta: Record<string, unknown>;
    created_at: string;
  }[];
  devices: {
    ip: string;
    platform: string | null;
    city: string | null;
    country: string | null;
    is_standalone: boolean | null;
    last_seen_at: string;
    hits: number;
  }[];
  linked_accounts: {
    user_id: string;
    email: string | null;
    role: string | null;
    ip: string;
    last_seen_at: string;
  }[];
};

/** Une action est ACTIVE si non révoquée et non expirée. */
export function isFraudActionActive(a: FraudActionRow): boolean {
  return (
    !a.revoked_at && (!a.expires_at || new Date(a.expires_at) > new Date())
  );
}

export function fraudActorHref(kind: FraudActorKind, id: string): string {
  return `/admin/anti-fraude/comptes/${kind}/${id}`;
}

/** Libellés FR des types d'événements de la timeline. */
export const FRAUD_EVENT_LABEL: Record<string, string> = {
  cancel: "Annulation",
  offer_seen: "Offre vue",
  offer_ignored: "Offre ignorée",
  offer_declined: "Offre refusée",
  offer_accepted: "Offre acceptée",
  call_initiated: "Appel émis",
  contact_revealed: "Contact révélé",
  forced_offline: "Hors ligne forcé",
  went_online: "Passé en ligne",
  went_offline: "Passé hors ligne",
  ack_required: "Popup exigée",
  ack_shown: "Popup affichée",
  ack_given: "Popup acceptée",
  action_applied: "Mesure appliquée",
  action_revoked: "Mesure révoquée",
};
