import { History, ShieldCheck } from "lucide-react";
import { ORDER_STATUS_META, type OrderStatus } from "@/lib/types";
import type {
  AdminOrderAuditRow,
  AdminOrderEvent,
} from "@/lib/data/admin-orders";

// =============================================================================
// Historique complet d'une commande (fiche super-admin) : jalons du cycle de
// vie (horodatages orders), événements métier (order_events) et actions
// administratives (admin_audit_log : qui, quand, avant/après, motif, IP) —
// fusionnés en UNE chronologie. Composant serveur (rendu pur).
// =============================================================================

const ADMIN_ACTION_LABEL: Record<string, string> = {
  validate_delivery: "Livraison validée par la plateforme",
  cancel_order: "Commande annulée par la plateforme",
  confirm_online_noshow: "No-show en ligne confirmé",
  refund_merchant: "Commerçant remboursé",
  refund_customer: "Client remboursé (Coligo Pay)",
  compensate_driver: "Livreur indemnisé",
  no_compensation: "Décision : pas d'indemnisation",
  reassign_order_pool: "Commande remise au réseau",
  reassign_order_driver: "Commande réattribuée à un livreur",
  mark_delivery_failed: "Livraison marquée en échec",
};

type TimelineEntry = {
  key: string;
  at: string;
  title: string;
  detail?: string | null;
  admin?: string | null;
  ip?: string | null;
  kind: "milestone" | "event" | "admin";
};

const dt = (v: string) =>
  new Date(v).toLocaleString("fr-DZ", {
    timeZone: "Africa/Algiers",
    day: "2-digit",
    month: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });

function statusLabel(s: string | null): string {
  if (!s) return "—";
  return ORDER_STATUS_META[s as OrderStatus]?.label ?? s;
}

function jsonSummary(v: Record<string, unknown> | null): string | null {
  if (!v) return null;
  const parts = Object.entries(v)
    .filter(([, val]) => val !== null && val !== undefined)
    .map(([k, val]) => `${k}: ${String(val)}`);
  return parts.length ? parts.join(" · ") : null;
}

export function OrderAdminTimeline({
  order,
  events,
  audit,
}: {
  order: {
    created_at: string;
    prep_started_at: string | null;
    marked_ready_at: string | null;
    driver_notified_at: string | null;
    driver_claimed_at: string | null;
    delivery_picked_up_at: string | null;
    delivery_arrived_at: string | null;
    delivery_delivered_at: string | null;
    delivery_failed_at: string | null;
    delivery_no_show_at: string | null;
  };
  events: AdminOrderEvent[];
  audit: AdminOrderAuditRow[];
}) {
  const entries: TimelineEntry[] = [];

  const milestone = (at: string | null, title: string) => {
    if (at)
      entries.push({ key: `m-${title}-${at}`, at, title, kind: "milestone" });
  };
  milestone(order.created_at, "Commande créée");
  milestone(order.prep_started_at, "Préparation commencée");
  milestone(order.marked_ready_at, "Marquée prête");
  milestone(order.driver_claimed_at, "Prise par le livreur");
  milestone(order.delivery_picked_up_at, "Récupérée chez le commerçant");
  milestone(order.delivery_arrived_at, "Livreur arrivé chez le client");
  milestone(order.delivery_delivered_at, "Livrée");
  milestone(order.delivery_failed_at, "Échec de livraison");
  milestone(order.delivery_no_show_at, "No-show client");

  for (const e of events) {
    entries.push({
      key: `e-${e.id}`,
      at: e.created_at,
      title:
        e.from_status === e.to_status
          ? "Événement"
          : `${statusLabel(e.from_status)} → ${statusLabel(e.to_status)}`,
      detail: e.note,
      kind: "event",
    });
  }

  for (const a of audit) {
    const values = [
      a.old_value ? `avant — ${jsonSummary(a.old_value)}` : null,
      a.new_value ? `après — ${jsonSummary(a.new_value)}` : null,
    ]
      .filter(Boolean)
      .join(" · ");
    entries.push({
      key: `a-${a.id}`,
      at: a.created_at,
      title: ADMIN_ACTION_LABEL[a.action] ?? a.action,
      detail: [a.note, values || null].filter(Boolean).join(" · ") || null,
      admin: a.admin_email,
      ip: a.ip,
      kind: "admin",
    });
  }

  entries.sort((x, y) => new Date(x.at).getTime() - new Date(y.at).getTime());

  return (
    <section className="border-border bg-surface rounded-card-lg mt-3 border p-4">
      <h2 className="text-muted flex items-center gap-1.5 text-xs font-bold uppercase">
        <History className="size-3.5" />
        Historique complet
      </h2>
      <ol className="mt-3 space-y-0">
        {entries.map((e, i) => (
          <li key={e.key} className="relative flex gap-3 pb-4 last:pb-0">
            {/* Rail vertical */}
            {i < entries.length - 1 && (
              <span
                aria-hidden
                className="bg-border absolute top-4 left-[5px] h-full w-px"
              />
            )}
            <span
              aria-hidden
              className={
                "relative mt-1.5 size-[11px] shrink-0 rounded-full border-2 " +
                (e.kind === "admin"
                  ? "border-primary-600 bg-primary-100"
                  : e.kind === "event"
                    ? "border-border bg-surface-3"
                    : "border-success-600 bg-success-100")
              }
            />
            <div className="min-w-0">
              <p className="text-sm font-semibold">
                {e.kind === "admin" && (
                  <ShieldCheck className="text-primary-700 mr-1 inline size-3.5 align-[-2px]" />
                )}
                {e.title}
                <span className="text-subtle ml-2 text-xs font-normal tabular-nums">
                  {dt(e.at)}
                </span>
              </p>
              {e.detail && (
                <p className="text-muted mt-0.5 text-xs">{e.detail}</p>
              )}
              {(e.admin || e.ip) && (
                <p className="text-subtle text-caption mt-0.5">
                  {e.admin ?? "admin"}
                  {e.ip ? ` · IP ${e.ip}` : ""}
                </p>
              )}
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}
