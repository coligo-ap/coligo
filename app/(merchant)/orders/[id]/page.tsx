import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Clock, Phone, User } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { OrderStatusTimeline } from "@/components/merchant/order-status-timeline";
import { OrderActions } from "@/components/merchant/order-actions";
import {
  ORDER_STATUS_META,
  type OrderEvent,
  type OrderWithItems,
} from "@/lib/types";
import {
  countItems,
  formatDA,
  formatRelativeTime,
  formatTime,
} from "@/lib/utils";

export const dynamic = "force-dynamic";

export default async function OrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();

  // RLS garantit qu'on ne récupère qu'une commande du commerçant connecté.
  const [{ data: order }, { data: events }] = await Promise.all([
    supabase
      .from("orders")
      .select(
        `id, merchant_id, customer_name, customer_phone, status,
         total_da, service_fee_da, cashback_da, commission_da,
         pickup_code, pickup_slot_at, notes, created_at,
         order_items ( id, order_id, product_name, unit_price_da, quantity, line_total_da )`
      )
      .eq("id", id)
      .maybeSingle(),
    supabase
      .from("order_events")
      .select(
        "id, order_id, from_status, to_status, client_operation_id, note, created_at"
      )
      .eq("order_id", id)
      .order("created_at", { ascending: true }),
  ]);

  if (!order) notFound();

  const o = order as OrderWithItems & {
    service_fee_da: number;
    cashback_da: number;
    commission_da: number;
  };
  const orderEvents = (events ?? []) as OrderEvent[];
  const meta = ORDER_STATUS_META[o.status];
  const shortId = o.id.slice(0, 6).toUpperCase();
  const subtotal = o.order_items.reduce((s, it) => s + it.line_total_da, 0);
  // Montants figés (jamais recalculés).
  const payout = o.total_da - o.commission_da;

  return (
    <div className="mx-auto max-w-[1100px] p-4 pb-28 lg:p-6 lg:px-8 lg:pb-6">
      {/* Header */}
      <header className="mb-6">
        <Link
          href="/orders"
          className="text-muted hover:text-foreground mb-3 inline-flex items-center gap-1.5 text-sm"
        >
          <ArrowLeft className="size-4" />
          Retour aux commandes
        </Link>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <h1 className="font-mono text-2xl font-bold tracking-tight lg:text-3xl">
              #{shortId}
            </h1>
            <Badge tone={meta.tone}>{meta.label}</Badge>
          </div>
          <p className="text-muted flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
            <span>Créée {formatRelativeTime(o.created_at)}</span>
            <span className="inline-flex items-center gap-1.5">
              <Clock className="size-4" />
              Retrait à {formatTime(o.pickup_slot_at)}
            </span>
          </p>
        </div>
      </header>

      <div className="grid gap-5 lg:grid-cols-[1fr_360px]">
        {/* Colonne gauche : items + timeline */}
        <div className="space-y-5">
          {/* Items */}
          <section className="border-border bg-surface rounded-[16px] border">
            <header className="border-border flex items-center justify-between border-b px-5 py-4">
              <h2 className="text-base font-semibold">Articles</h2>
              <span className="text-muted text-sm">
                {countItems(o.order_items)} article
                {countItems(o.order_items) > 1 ? "s" : ""}
              </span>
            </header>
            <ul className="divide-border divide-y">
              {o.order_items.map((item) => (
                <li
                  key={item.id}
                  className="flex items-center gap-3 px-5 py-3.5"
                >
                  <span className="bg-primary-50 text-primary-700 flex size-9 shrink-0 items-center justify-center rounded-[10px] text-sm font-semibold tabular-nums">
                    {item.quantity}×
                  </span>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm font-medium">
                      {item.product_name}
                    </p>
                    <p className="text-muted text-xs">
                      {formatDA(item.unit_price_da)} l&apos;unité
                    </p>
                  </div>
                  <span className="text-sm font-semibold tabular-nums">
                    {formatDA(item.line_total_da)}
                  </span>
                </li>
              ))}
              {o.order_items.length === 0 && (
                <li className="text-muted px-5 py-6 text-center text-sm">
                  Aucun article détaillé.
                </li>
              )}
            </ul>

            {/* Récap (montants figés à la création) */}
            <div className="border-border space-y-2 border-t px-5 py-4 text-sm">
              <Recap label="Sous-total" value={subtotal} />
              {o.service_fee_da > 0 && (
                <Recap label="Frais de service" value={o.service_fee_da} />
              )}
              {o.cashback_da > 0 && (
                <Recap label="Cashback" value={-o.cashback_da} tone="muted" />
              )}
              <div className="flex justify-between font-semibold">
                <span>Total</span>
                <span className="tabular-nums">{formatDA(o.total_da)}</span>
              </div>
              <div className="text-muted border-border mt-1 flex justify-between border-t pt-2 text-xs">
                <span>Commission Coligo</span>
                <span className="tabular-nums">
                  −{formatDA(o.commission_da)}
                </span>
              </div>
              <div className="text-success-700 flex justify-between text-xs font-medium">
                <span>Vous percevez</span>
                <span className="tabular-nums">{formatDA(payout)}</span>
              </div>
            </div>
          </section>

          {/* Timeline */}
          <section className="border-border bg-surface rounded-[16px] border p-5">
            <h2 className="mb-4 text-base font-semibold">Suivi</h2>
            <OrderStatusTimeline status={o.status} events={orderEvents} />
          </section>

          {o.notes && o.notes !== "seed" && (
            <section className="border-border bg-surface rounded-[16px] border p-5">
              <h2 className="mb-1.5 text-base font-semibold">Note du client</h2>
              <p className="text-muted text-sm">{o.notes}</p>
            </section>
          )}
        </div>

        {/* Colonne droite : client + retrait + actions */}
        <div className="space-y-5">
          {/* Client */}
          <section className="border-border bg-surface rounded-[16px] border p-5">
            <h2 className="mb-3 text-base font-semibold">Client</h2>
            <div className="space-y-2.5">
              <div className="flex items-center gap-2.5 text-sm">
                <User className="text-subtle size-4 shrink-0" />
                <span className="font-medium">{o.customer_name}</span>
              </div>
              <a
                href={`tel:${o.customer_phone}`}
                className="text-primary-700 hover:bg-primary-50 -mx-2 flex items-center gap-2.5 rounded-[10px] px-2 py-1.5 text-sm transition-colors"
              >
                <Phone className="size-4 shrink-0" />
                <span className="font-medium">{o.customer_phone}</span>
              </a>
            </div>
          </section>

          {/* Retrait */}
          <section className="border-primary-200 bg-primary-50/60 rounded-[16px] border p-5 text-center">
            <p className="text-primary-900/70 text-xs font-medium tracking-wide uppercase">
              Code de retrait
            </p>
            <p className="text-primary-800 my-1 font-mono text-4xl font-bold tracking-[0.2em]">
              {o.pickup_code}
            </p>
            <p className="text-primary-900/70 flex items-center justify-center gap-1.5 text-sm">
              <Clock className="size-3.5" />
              Créneau à {formatTime(o.pickup_slot_at)}
            </p>
          </section>

          {/* Actions — sticky en bas sur mobile, carte sur desktop */}
          <section className="border-border bg-surface fixed inset-x-0 bottom-0 z-20 border-t p-4 shadow-[0_-4px_12px_rgba(0,0,0,0.04)] lg:static lg:rounded-[16px] lg:border lg:p-5 lg:shadow-none">
            <h2 className="mb-3 hidden text-base font-semibold lg:block">
              Action
            </h2>
            <div className="mx-auto max-w-[1100px] lg:max-w-none">
              <OrderActions orderId={o.id} status={o.status} />
            </div>
          </section>
        </div>
      </div>
    </div>
  );
}

function Recap({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone?: "muted";
}) {
  return (
    <div className="flex justify-between">
      <span className="text-muted">{label}</span>
      <span
        className={
          tone === "muted" ? "text-muted tabular-nums" : "tabular-nums"
        }
      >
        {value < 0 ? "−" : ""}
        {formatDA(Math.abs(value))}
      </span>
    </div>
  );
}
