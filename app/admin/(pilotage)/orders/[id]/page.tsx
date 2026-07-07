import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Banknote,
  Bike,
  CreditCard,
  MapPin,
  Phone,
  Receipt,
  Store,
  User,
  Wallet,
} from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { formatDA } from "@/lib/utils";
import { ORDER_STATUS_META, type OrderStatus } from "@/lib/types";
import { getAdminOrderDetail } from "@/lib/data/admin-orders";
import { OrderAdminPanel } from "@/components/admin/pilotage/order-admin-panel";
import { OrderAdminTimeline } from "@/components/admin/pilotage/order-admin-timeline";

export const dynamic = "force-dynamic";

/**
 * Fiche commande super-admin : détails complets, historique (order_events +
 * audit admin + écritures financières), et TOUTES les actions de gestion
 * (valider, annuler, échec, no-show, réattribuer, indemniser, rembourser).
 * Gate domaine : layout (pilotage) + self-guard du loader (service_role).
 */

const dt = (v: string | null | undefined) =>
  v
    ? new Date(v).toLocaleString("fr-DZ", {
        timeZone: "Africa/Algiers",
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      })
    : null;

export default async function AdminOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const detail = await getAdminOrderDetail(id);
  if (!detail) notFound();

  const {
    order: o,
    merchantName,
    driver,
    items,
    events,
    ledger,
    wallet,
    audit,
    candidates,
  } = detail;

  const meta = ORDER_STATUS_META[o.status as OrderStatus];
  const isDelivery = o.fulfillment_type === "delivery";
  const terminal = o.status === "completed" || o.status === "cancelled";
  const statusLabel =
    o.status === "completed" && isDelivery
      ? "Livrée"
      : (meta?.label ?? o.status);

  // Payé réellement par le client (miroir de la règle SQL admin_refund_customer).
  const paidDa =
    (o.cashback_used_da ?? 0) +
    (o.topup_used_da ?? 0) +
    (o.payment_method === "online"
      ? o.payment_status === "paid" || o.payment_status === "refunded"
        ? o.total_da
        : 0
      : o.status === "completed"
        ? o.total_da
        : 0);
  const refundRemaining =
    o.status === "completed" && o.payment_status !== "refunded"
      ? Math.max(0, paidDa - (o.admin_refunded_da ?? 0))
      : 0;

  const alreadyCompensated = ledger.some(
    (l) => l.type === "driver_compensation"
  );

  return (
    <div className="mx-auto max-w-4xl p-4 lg:p-6">
      <Link
        href="/admin/orders"
        className="text-muted hover:text-foreground inline-flex items-center gap-1.5 text-sm font-medium"
      >
        <ArrowLeft className="size-4" />
        Commandes
      </Link>

      {/* ---- En-tête ---- */}
      <header className="mt-3 flex flex-wrap items-start justify-between gap-3">
        <div>
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="font-mono text-2xl font-bold tracking-tight">
              #{o.order_number ?? o.id.slice(0, 6).toUpperCase()}
            </h1>
            <Badge tone={meta?.tone ?? "neutral"}>{statusLabel}</Badge>
            <Badge tone="neutral">
              {isDelivery
                ? o.delivery_mode === "tour"
                  ? "Livraison tournée"
                  : "Livraison express"
                : "Retrait"}
            </Badge>
            {o.delivery_no_show_at && <Badge tone="warning">No-show</Badge>}
            {o.delivery_failed_at && (
              <Badge tone="danger">Échec livraison</Badge>
            )}
            {(o.admin_refunded_da ?? 0) > 0 && (
              <Badge tone="primary">
                Remboursée
                {o.payment_status !== "refunded" ? " partiellement" : ""}
              </Badge>
            )}
          </div>
          <p className="text-muted mt-1 text-sm">
            Créée le {dt(o.created_at)}
            {o.cancelled_by ? ` · annulée par : ${o.cancelled_by}` : ""}
          </p>
        </div>
        <p className="text-2xl font-bold tabular-nums">
          {formatDA(o.total_da)}
        </p>
      </header>

      {/* ---- Acteurs ---- */}
      <div className="mt-4 grid gap-3 lg:grid-cols-3">
        <section className="border-border bg-surface rounded-[14px] border p-4">
          <h2 className="text-muted flex items-center gap-1.5 text-xs font-bold uppercase">
            <User className="size-3.5" />
            Client
          </h2>
          <p className="mt-2 text-sm font-bold">{o.customer_name ?? "—"}</p>
          {o.customer_phone && (
            <p className="text-muted mt-0.5 flex items-center gap-1 text-xs">
              <Phone className="size-3" />
              {o.customer_phone}
            </p>
          )}
          {isDelivery && (
            <>
              {o.delivery_recipient_name && (
                <p className="text-muted mt-1 text-xs">
                  Destinataire : {o.delivery_recipient_name}
                  {o.delivery_phone ? ` · ${o.delivery_phone}` : ""}
                </p>
              )}
              {o.delivery_address_text && (
                <p className="text-muted mt-1 flex items-start gap-1 text-xs">
                  <MapPin className="mt-0.5 size-3 shrink-0" />
                  {o.delivery_address_text}
                </p>
              )}
            </>
          )}
          {o.customer_note && (
            <p className="text-subtle mt-1 text-xs italic">
              « {o.customer_note} »
            </p>
          )}
        </section>

        <section className="border-border bg-surface rounded-[14px] border p-4">
          <h2 className="text-muted flex items-center gap-1.5 text-xs font-bold uppercase">
            <Store className="size-3.5" />
            Commerçant
          </h2>
          <p className="mt-2 text-sm font-bold">{merchantName}</p>
          <Link
            href={`/admin/orders?mq=${o.merchant_id}`}
            className="text-primary-700 mt-1 inline-block text-xs font-semibold hover:underline"
          >
            Toutes ses commandes →
          </Link>
        </section>

        <section className="border-border bg-surface rounded-[14px] border p-4">
          <h2 className="text-muted flex items-center gap-1.5 text-xs font-bold uppercase">
            <Bike className="size-3.5" />
            Livreur
          </h2>
          {driver ? (
            <>
              <p className="mt-2 text-sm font-bold">{driver.full_name}</p>
              {driver.phone && (
                <p className="text-muted mt-0.5 flex items-center gap-1 text-xs">
                  <Phone className="size-3" />
                  {driver.phone}
                </p>
              )}
              <div className="mt-1 flex flex-wrap gap-x-3 text-xs">
                <Link
                  href={`/admin/drivers/${driver.id}`}
                  className="text-primary-700 font-semibold hover:underline"
                >
                  Sa fiche →
                </Link>
                <Link
                  href={`/admin/orders?dq=${driver.id}`}
                  className="text-primary-700 font-semibold hover:underline"
                >
                  Ses commandes →
                </Link>
              </div>
            </>
          ) : (
            <p className="text-muted mt-2 text-sm">
              {isDelivery && !terminal
                ? "Aucun livreur attribué — la commande est dans le réseau."
                : "Aucun livreur."}
            </p>
          )}
        </section>
      </div>

      {/* ---- Articles + montants ---- */}
      <section className="border-border bg-surface mt-3 rounded-[14px] border p-4">
        <h2 className="text-muted flex items-center gap-1.5 text-xs font-bold uppercase">
          <Receipt className="size-3.5" />
          Articles
        </h2>
        <ul className="divide-border mt-2 divide-y">
          {items.map((it) => (
            <li
              key={it.id}
              className="flex items-center justify-between gap-3 py-2 text-sm"
            >
              <span className="min-w-0 truncate">
                <span className="text-muted tabular-nums">
                  {Number(it.quantity)}
                  {it.unit && it.unit !== "piece" ? ` ${it.unit}` : "×"}
                </span>{" "}
                {it.product_name}
                {it.is_free && (
                  <Badge tone="success" className="ml-1.5">
                    Offert
                  </Badge>
                )}
              </span>
              <span className="shrink-0 font-semibold tabular-nums">
                {formatDA(it.line_total_da)}
              </span>
            </li>
          ))}
        </ul>
        <dl className="border-border mt-2 space-y-1 border-t pt-2 text-sm">
          {o.subtotal_da != null && (
            <Row label="Sous-total" value={formatDA(o.subtotal_da)} />
          )}
          {(o.discount_da ?? 0) > 0 && (
            <Row label="Remise" value={`− ${formatDA(o.discount_da ?? 0)}`} />
          )}
          {isDelivery && o.delivery_fee_da != null && (
            <Row
              label="Frais de livraison"
              value={formatDA(o.delivery_fee_da)}
            />
          )}
          {(o.service_fee_da ?? 0) > 0 && (
            <Row
              label="Frais de service"
              value={formatDA(o.service_fee_da ?? 0)}
            />
          )}
          {(o.cashback_used_da ?? 0) > 0 && (
            <Row
              label="Cashback utilisé"
              value={`− ${formatDA(o.cashback_used_da ?? 0)}`}
            />
          )}
          {(o.topup_used_da ?? 0) > 0 && (
            <Row
              label="Coligo Pay utilisé"
              value={`− ${formatDA(o.topup_used_da ?? 0)}`}
            />
          )}
          <div className="flex items-center justify-between pt-1 font-bold">
            <dt>Total</dt>
            <dd className="tabular-nums">{formatDA(o.total_da)}</dd>
          </div>
        </dl>
      </section>

      {/* ---- Paiement ---- */}
      <section className="border-border bg-surface mt-3 rounded-[14px] border p-4">
        <h2 className="text-muted flex items-center gap-1.5 text-xs font-bold uppercase">
          {o.payment_method === "online" ? (
            <CreditCard className="size-3.5" />
          ) : (
            <Banknote className="size-3.5" />
          )}
          Paiement
        </h2>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-sm">
          <Badge tone="neutral">
            {o.payment_method === "online" ? "En ligne (carte)" : "Espèces"}
          </Badge>
          <Badge
            tone={
              o.payment_status === "paid"
                ? "success"
                : o.payment_status === "refunded"
                  ? "primary"
                  : o.payment_status === "failed"
                    ? "danger"
                    : "warning"
            }
          >
            {{
              pending: "En attente de paiement",
              paid: "Payée",
              failed: "Paiement échoué",
              refunded: "Remboursée",
            }[o.payment_status] ?? o.payment_status}
          </Badge>
          {((o.cashback_used_da ?? 0) > 0 || (o.topup_used_da ?? 0) > 0) && (
            <Badge tone="neutral">
              Mixte : {o.payment_method === "online" ? "carte" : "espèces"}
              {(o.topup_used_da ?? 0) > 0 ? " + Coligo Pay" : ""}
              {(o.cashback_used_da ?? 0) > 0 ? " + cashback" : ""}
            </Badge>
          )}
        </div>
        <dl className="mt-2 space-y-1 text-sm">
          <Row label="Déboursé réel client" value={formatDA(paidDa)} />
          {(o.admin_refunded_da ?? 0) > 0 && (
            <Row
              label="Déjà remboursé (support)"
              value={`− ${formatDA(o.admin_refunded_da ?? 0)}`}
            />
          )}
        </dl>
        {wallet.length > 0 && (
          <div className="border-border mt-2 border-t pt-2">
            <p className="text-muted flex items-center gap-1 text-xs font-semibold">
              <Wallet className="size-3" />
              Écritures portefeuille client liées
            </p>
            <ul className="mt-1 space-y-0.5 text-xs">
              {wallet.map((w) => (
                <li
                  key={w.id}
                  className="text-muted flex justify-between gap-2"
                >
                  <span>
                    {dt(w.created_at)} · {w.type} ({w.source})
                    {w.note ? ` — ${w.note}` : ""}
                  </span>
                  <span className="shrink-0 font-semibold tabular-nums">
                    {w.amount_da > 0 ? "+" : ""}
                    {formatDA(w.amount_da)}
                  </span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </section>

      {/* ---- Écritures livreur ---- */}
      {ledger.length > 0 && (
        <section className="border-border bg-surface mt-3 rounded-[14px] border p-4">
          <h2 className="text-muted flex items-center gap-1.5 text-xs font-bold uppercase">
            <Bike className="size-3.5" />
            Écritures livreur (grand livre)
          </h2>
          <ul className="mt-2 space-y-0.5 text-xs">
            {ledger.map((l) => (
              <li key={l.id} className="text-muted flex justify-between gap-2">
                <span>
                  {dt(l.created_at)} · {l.type}
                  {l.driver_name ? ` · ${l.driver_name}` : ""}
                  {l.note ? ` — ${l.note}` : ""}
                  {l.settled_at ? " · réglée" : ""}
                </span>
                <span className="shrink-0 font-semibold tabular-nums">
                  {formatDA(l.amount_da)}
                </span>
              </li>
            ))}
          </ul>
        </section>
      )}

      {/* ---- Actions de gestion ---- */}
      <OrderAdminPanel
        order={{
          id: o.id,
          orderNumber: o.order_number,
          status: o.status,
          isDelivery,
          deliveryMode: o.delivery_mode,
          paymentMethod: o.payment_method,
          paymentStatus: o.payment_status,
          pickedUp: !!o.delivery_picked_up_at,
          driverId: o.delivery_driver_id,
          driverName: driver?.full_name ?? null,
          refundRemainingDa: refundRemaining,
          alreadyCompensated,
          ledgerDrivers: [
            ...new Map(
              ledger
                .filter((l) => l.driver_name)
                .map((l) => [
                  l.driver_id,
                  { id: l.driver_id, full_name: l.driver_name! },
                ])
            ).values(),
          ],
        }}
        candidates={candidates}
      />

      {/* ---- Historique ---- */}
      <OrderAdminTimeline
        order={{
          created_at: o.created_at,
          prep_started_at: o.prep_started_at,
          marked_ready_at: o.marked_ready_at,
          driver_notified_at: o.driver_notified_at,
          driver_claimed_at: o.driver_claimed_at,
          delivery_picked_up_at: o.delivery_picked_up_at,
          delivery_arrived_at: o.delivery_arrived_at,
          delivery_delivered_at: o.delivery_delivered_at,
          delivery_failed_at: o.delivery_failed_at,
          delivery_no_show_at: o.delivery_no_show_at,
        }}
        events={events}
        audit={audit}
      />
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="text-muted flex items-center justify-between">
      <dt>{label}</dt>
      <dd className="tabular-nums">{value}</dd>
    </div>
  );
}
