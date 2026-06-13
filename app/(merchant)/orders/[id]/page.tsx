import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, Clock, Phone, Truck, User } from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { deliveryPhase } from "@/lib/delivery/merchant-status";
import { OrderStatusTimeline } from "@/components/merchant/order-status-timeline";
import { OrderActions } from "@/components/merchant/order-actions";
import { PrintOrderButton } from "@/components/ticket/print-order-button";
import { orderToTicket } from "@/lib/ticket/order-to-ticket";
import { fetchCustomerOrderCount } from "@/lib/ticket/customer-orders";
import { fetchCategoryMap } from "@/lib/ticket/category-map";
import {
  ORDER_STATUS_META,
  type OrderEvent,
  type OrderWithItems,
  type PrintWidth,
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
         pickup_code, order_number, pickup_slot_at, notes, created_at,
         payment_method, payment_status,
         fulfillment_type, delivery_mode, delivery_fee_da,
         delivery_address_text, delivery_phone, delivery_recipient_name, delivery_note, delivery_distance_km,
         delivery_driver_id, delivery_picked_up_at, delivery_arrived_at, delivery_delivered_at,
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
    fulfillment_type: "pickup" | "delivery";
    delivery_mode: "express" | "tour" | null;
    delivery_fee_da: number;
    delivery_address_text: string | null;
    delivery_phone: string | null;
    delivery_recipient_name: string | null;
    delivery_distance_km: number | null;
    delivery_driver_id: string | null;
    delivery_picked_up_at: string | null;
    delivery_arrived_at: string | null;
    delivery_delivered_at: string | null;
  };

  // Réglages d'impression + nom du commerce pour le ticket. RLS filtre déjà
  // sur le commerçant connecté.
  const { data: merchant } = await supabase
    .from("merchants")
    .select("name, print_width, print_copies")
    .eq("id", o.merchant_id)
    .maybeSingle();
  // Enrichit chaque item avec sa catégorie (best-effort, fallback « ARTICLES »).
  const categoryMap = await fetchCategoryMap(
    supabase,
    o.merchant_id,
    o.order_items.map((it) => it.product_name)
  );
  const customerOrderCount = await fetchCustomerOrderCount(
    supabase,
    o.merchant_id,
    o.customer_phone
  );
  const ticketOrder = orderToTicket(
    o,
    merchant?.name ?? "Coligo",
    categoryMap,
    {
      customerOrderCount,
    }
  );
  const printWidth = (merchant?.print_width ?? 50) as PrintWidth;
  const printCopies = merchant?.print_copies ?? 1;
  const orderEvents = (events ?? []) as OrderEvent[];
  const meta = ORDER_STATUS_META[o.status];
  // Référence publique affichée : numéro de commande (#A073), jamais le hash interne.
  const orderRef = o.order_number ?? o.id.slice(0, 6).toUpperCase();
  const subtotal = o.order_items.reduce((s, it) => s + it.line_total_da, 0);

  // Regroupe les articles par catégorie (ordre = première apparition) pour
  // que le commerçant lise la commande rayon par rayon. Fallback « Articles ».
  const itemGroups: Array<{
    title: string;
    items: typeof o.order_items;
  }> = [];
  const groupIndex = new Map<string, number>();
  for (const item of o.order_items) {
    const title = categoryMap[item.product_name]?.trim() || "Articles";
    let idx = groupIndex.get(title);
    if (idx === undefined) {
      idx = itemGroups.length;
      groupIndex.set(title, idx);
      itemGroups.push({ title, items: [] });
    }
    itemGroups[idx].items.push(item);
  }
  // Montants figés (jamais recalculés).
  const payout = o.total_da - o.commission_da;

  return (
    <div className="mx-auto max-w-[1100px] p-4 pb-[calc(13rem+env(safe-area-inset-bottom))] lg:p-6 lg:px-8 lg:pb-6">
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
              #{orderRef}
            </h1>
            {(() => {
              const phase = deliveryPhase(o);
              if (phase) {
                const tone =
                  phase.tone === "success"
                    ? "green"
                    : phase.tone === "amber"
                      ? "amber"
                      : phase.tone === "neutral"
                        ? "stone"
                        : "teal";
                return <Badge tone={tone}>{phase.short}</Badge>;
              }
              return <Badge tone={meta.tone}>{meta.label}</Badge>;
            })()}
          </div>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-2">
            <p className="text-muted flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span>Créée {formatRelativeTime(o.created_at)}</span>
              <span className="inline-flex items-center gap-1.5">
                <Clock className="size-4" />
                Retrait à {formatTime(o.pickup_slot_at)}
              </span>
            </p>
            <PrintOrderButton
              order={ticketOrder}
              width={printWidth}
              copies={printCopies}
              size="sm"
              label="Imprimer"
            />
          </div>
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
            <div className="divide-border divide-y">
              {itemGroups.map((group) => (
                <div key={group.title}>
                  {/* En-tête de catégorie — aide le commerçant à préparer rayon par rayon */}
                  <div className="bg-surface-2/60 text-subtle flex items-center justify-between px-5 py-2 text-xs font-semibold tracking-wide uppercase">
                    <span>{group.title}</span>
                    <span className="tabular-nums">
                      {countItems(group.items)} art.
                    </span>
                  </div>
                  <ul className="divide-border divide-y">
                    {group.items.map((item) => (
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
                  </ul>
                </div>
              ))}
              {o.order_items.length === 0 && (
                <p className="text-muted px-5 py-6 text-center text-sm">
                  Aucun article détaillé.
                </p>
              )}
            </div>

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
            <div className="space-y-3">
              <div className="flex items-center gap-2.5 text-sm">
                <User className="text-subtle size-4 shrink-0" />
                <span className="font-medium">{o.customer_name}</span>
              </div>
              {/* Bouton « Appeler le client » : tap-to-call bien visible */}
              <a
                href={`tel:${o.customer_phone}`}
                className="bg-primary-600 hover:bg-primary-700 flex items-center justify-center gap-2 rounded-[12px] px-3 py-2.5 text-sm font-semibold text-white transition-colors"
              >
                <Phone className="size-4 shrink-0" />
                <span className="tabular-nums">{o.customer_phone}</span>
              </a>
            </div>
          </section>

          {/* Retrait OU Livraison : pour la livraison, le code est MASQUÉ
              côté commerçant (cf. PROMPT 9 anti-fraude — le client communique
              son code au livreur, le commerçant ne doit JAMAIS le voir). */}
          {o.fulfillment_type === "delivery" ? (
            <section className="border-warning-200 bg-warning-50 rounded-[16px] border p-5">
              <p className="text-warning-700 mb-2 text-xs font-semibold tracking-wide uppercase">
                Commande en LIVRAISON
              </p>
              {(() => {
                const phase = deliveryPhase(o);
                if (!phase) return null;
                return (
                  <p className="bg-surface text-foreground mb-2 inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-bold">
                    <Truck className="text-primary-600 size-3.5" />
                    {phase.label}
                  </p>
                );
              })()}
              <p className="text-sm font-medium">
                Mode : {o.delivery_mode === "express" ? "Express" : "Tournée"} ·
                Frais : {o.delivery_fee_da ?? 0} DA
              </p>
              {o.delivery_recipient_name && (
                <p className="mt-1 text-sm font-semibold">
                  Destinataire : {o.delivery_recipient_name}
                  {o.delivery_phone ? ` · ${o.delivery_phone}` : ""}
                </p>
              )}
              {o.delivery_address_text && (
                <p className="text-muted mt-1 text-xs">
                  {o.delivery_address_text}
                </p>
              )}
              {o.delivery_distance_km != null && (
                <p className="text-subtle mt-0.5 text-xs">
                  Distance : {o.delivery_distance_km} km
                </p>
              )}
              <p className="text-muted mt-2 text-xs italic">
                🔒 Code de retrait masqué (sécurité) — le client le donne au
                livreur.
              </p>
            </section>
          ) : (
            <section className="border-primary-200 bg-primary-50/60 rounded-[16px] border p-5 text-center">
              <p className="text-primary-900/70 text-xs font-medium tracking-wide uppercase">
                Numéro de commande
              </p>
              <p className="text-primary-800 my-1 font-mono text-4xl font-bold tracking-[0.15em]">
                #{o.order_number ?? o.id.slice(0, 6).toUpperCase()}
              </p>
              <p className="text-primary-900/70 flex items-center justify-center gap-1.5 text-sm">
                <Clock className="size-3.5" />
                Créneau à {formatTime(o.pickup_slot_at)}
              </p>
              <p className="text-muted mt-2 text-xs italic">
                {o.payment_method === "online"
                  ? "🔒 Payé en ligne — demande au client son code à 4 chiffres."
                  : "💵 Cash — encaisse et confirme, aucun code requis."}
              </p>
            </section>
          )}

          {/* Actions — sticky en bas sur mobile, carte sur desktop */}
          <section className="border-border bg-surface fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 border-t p-4 shadow-[0_-4px_12px_rgba(0,0,0,0.04)] lg:static lg:bottom-auto lg:rounded-[16px] lg:border lg:p-5 lg:shadow-none">
            <h2 className="mb-3 hidden text-base font-semibold lg:block">
              Action
            </h2>
            <div className="mx-auto max-w-[1100px] lg:max-w-none">
              <OrderActions
                orderId={o.id}
                status={o.status}
                fulfillmentType={o.fulfillment_type}
                paymentMethod={o.payment_method}
                deliveryPickedUpAt={o.delivery_picked_up_at}
              />
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
