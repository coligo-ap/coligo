import Link from "next/link";
import { notFound } from "next/navigation";
import {
  ArrowLeft,
  Banknote,
  Bike,
  ChevronDown,
  Clock,
  CreditCard,
  Lock,
  Package,
  Phone,
  StickyNote,
  Truck,
  User,
  Wallet,
} from "lucide-react";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { deliveryPhase } from "@/lib/delivery/merchant-status";
import { OrderStatusTimeline } from "@/components/merchant/order-status-timeline";
import { OrderActions } from "@/components/merchant/order-actions";
import { PrintOrderButton } from "@/components/ticket/print-order-button";
import { orderToTicket } from "@/lib/ticket/order-to-ticket";
import { isScheduled } from "@/lib/orders/scheduled";
import {
  computeMerchantEarnings,
  type MerchantOrderEarnings,
} from "@/lib/finances/order-earnings";
import { fetchCustomerOrderCount } from "@/lib/ticket/customer-orders";
import { fetchCategoryMap } from "@/lib/ticket/category-map";
import { formatQtyUnit } from "@/lib/ticket/ticket-format";
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
         net_total_da, subtotal_da, discount_da, commission_rate_applied,
         cashback_used_da, topup_used_da, tour_delivery_commission_da,
         pickup_code, order_number, pickup_type, pickup_slot_at, notes, created_at,
         payment_method, payment_status,
         fulfillment_type, delivery_mode, delivery_fee_da,
         delivery_address_text, delivery_phone, delivery_recipient_name, delivery_note, delivery_distance_km,
         delivery_driver_id, delivery_picked_up_at, delivery_arrived_at, delivery_delivered_at,
         order_items ( id, order_id, product_name, name_ar, unit, is_free,
           unit_price_da, quantity, line_total_da,
           order_item_options ( group_name_fr, group_name_ar, option_name_fr,
             option_name_ar, price_delta_da, position ) )`
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

  const o = order as unknown as OrderWithItems & {
    service_fee_da: number;
    cashback_da: number;
    commission_da: number;
    net_total_da: number | null;
    subtotal_da: number | null;
    discount_da: number | null;
    commission_rate_applied: number | null;
    cashback_used_da: number | null;
    topup_used_da: number | null;
    tour_delivery_commission_da: number | null;
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

  // PERF : ces 4 lectures ne dépendent QUE de la commande déjà chargée →
  // UN aller-retour groupé au lieu de 4 en cascade (c'était la cause des
  // ouvertures de détail à 2-3 s). RLS filtre déjà sur le commerçant connecté.
  const [
    { data: merchant },
    categoryMap,
    customerOrderCount,
    { data: promoRows },
  ] = await Promise.all([
    // Réglages d'impression + nom du commerce pour le ticket.
    supabase
      .from("merchants")
      .select("name, print_width, print_copies, print_lang, commission_rate")
      .eq("id", o.merchant_id)
      .maybeSingle(),
    // Catégorie de chaque item (best-effort, fallback « ARTICLES »).
    fetchCategoryMap(
      supabase,
      o.merchant_id,
      o.order_items.map((it) => it.product_name)
    ),
    fetchCustomerOrderCount(supabase, o.merchant_id, o.customer_phone),
    supabase
      .from("order_promotions")
      .select("type, title_fr, title_ar, discount_da, free_qty, position")
      .eq("order_id", id)
      .order("position", { ascending: true }),
  ]);
  const ticketOrder = orderToTicket(
    o,
    merchant?.name ?? "Coligo",
    categoryMap,
    {
      customerOrderCount,
      scheduledFor: isScheduled(
        o as unknown as { pickup_type?: string; pickup_slot_at?: string }
      )
        ? o.pickup_slot_at
        : null,
      promotions: (promoRows ?? []).map((p) => ({
        type: p.type,
        title_fr: p.title_fr,
        title_ar: p.title_ar,
        discount_da: p.discount_da,
        free_qty: p.free_qty,
      })),
    }
  );
  const printWidth = (merchant?.print_width ?? 50) as PrintWidth;
  const printCopies = merchant?.print_copies ?? 1;
  // Langue unique du ticket (jamais FR/AR mélangés) — 'fr' par défaut.
  const printLang =
    (merchant as { print_lang?: string | null } | null)?.print_lang === "ar"
      ? ("ar" as const)
      : ("fr" as const);
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
  // Gains commerçant RÉELS — miroir du ledger (mig 0127), réconcilie avec
  // /finances. On NE fait PAS « total − commission » (faux : le total inclut
  // les frais de service plateforme et la livraison du livreur).
  const earnings = computeMerchantEarnings(o, {
    commissionRate: merchant?.commission_rate ?? undefined,
  });

  return (
    <div className="mx-auto max-w-[1100px] p-4 pb-[calc(13rem+env(safe-area-inset-bottom))] lg:p-6 lg:px-8 lg:pb-6">
      <Link
        href="/orders"
        className="text-muted hover:text-foreground mb-3 inline-flex items-center gap-1.5 text-sm"
      >
        <ArrowLeft className="size-4" />
        Retour aux commandes
      </Link>

      {/* ─── HERO compact (style Uber Eats) : TOUT l'essentiel d'un coup
          d'œil, sans scroller — n°, statut, type, créneau, paiement, client
          et appel en un tap. ─── */}
      <header className="border-border bg-surface mb-4 rounded-[16px] border p-4">
        <div className="flex flex-wrap items-center gap-2.5">
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
          <div className="ms-auto">
            <PrintOrderButton
              order={ticketOrder}
              width={printWidth}
              copies={printCopies}
              lang={printLang}
              size="sm"
              label="Imprimer"
            />
          </div>
        </div>

        {/* Méta : type · créneau · paiement · ancienneté */}
        <div className="text-muted mt-2.5 flex flex-wrap items-center gap-x-3 gap-y-1.5 text-xs font-medium">
          <span className="inline-flex items-center gap-1">
            {o.fulfillment_type === "delivery" ? (
              <Bike className="size-3.5" />
            ) : (
              <Package className="size-3.5" />
            )}
            {o.fulfillment_type === "delivery" ? "Livraison" : "Retrait"}
          </span>
          <span className="inline-flex items-center gap-1">
            <Clock className="size-3.5" />
            Créneau {formatTime(o.pickup_slot_at)}
          </span>
          <span
            className={
              o.payment_method === "online"
                ? "text-success-700 inline-flex items-center gap-1 font-semibold"
                : "inline-flex items-center gap-1"
            }
          >
            {o.payment_method === "online" ? (
              <CreditCard className="size-3.5" />
            ) : (
              <Banknote className="size-3.5" />
            )}
            {o.payment_method === "online" ? "Payé en ligne" : "Espèces"}
          </span>
          <span>Créée {formatRelativeTime(o.created_at)}</span>
        </div>

        {/* Client — toujours visible, appel en un tap */}
        <div className="border-border mt-3 flex items-center justify-between gap-3 border-t pt-3">
          <span className="flex min-w-0 items-center gap-2 text-sm font-semibold">
            <User className="text-subtle size-4 shrink-0" />
            <span className="truncate">{o.customer_name}</span>
          </span>
          <a
            href={`tel:${o.customer_phone}`}
            className="bg-primary-600 hover:bg-primary-700 inline-flex shrink-0 items-center gap-1.5 rounded-full px-3.5 py-2 text-sm font-bold text-white transition-colors"
          >
            <Phone className="size-4" />
            <span className="tabular-nums">{o.customer_phone}</span>
          </a>
        </div>
      </header>

      <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
        {/* Colonne gauche : note (critique pour préparer) + items + timeline */}
        <div className="space-y-4">
          {/* Note du client EN PREMIER — c'est ce qui change la préparation. */}
          {o.notes && o.notes !== "seed" && (
            <section className="border-warning-200 bg-warning-50 rounded-[14px] border p-3.5">
              <p className="text-warning-800 flex items-center gap-1.5 text-xs font-bold tracking-wide uppercase">
                <StickyNote className="size-3.5" />
                Note du client
              </p>
              <p className="text-foreground mt-1 text-sm font-medium">
                {o.notes}
              </p>
            </section>
          )}

          {/* Items */}
          <section className="border-border bg-surface rounded-[16px] border">
            <header className="border-border flex items-center justify-between border-b px-4 py-3">
              <h2 className="text-sm font-bold">Articles</h2>
              <span className="text-muted text-xs font-semibold tabular-nums">
                {countItems(o.order_items)} article
                {countItems(o.order_items) > 1 ? "s" : ""}
              </span>
            </header>
            <div className="divide-border divide-y">
              {itemGroups.map((group) => (
                <div key={group.title}>
                  {/* En-tête de catégorie — aide le commerçant à préparer rayon par rayon */}
                  <div className="bg-surface-2/60 text-subtle flex items-center justify-between px-4 py-1.5 text-[11px] font-semibold tracking-wide uppercase">
                    <span>{group.title}</span>
                    <span className="tabular-nums">
                      {countItems(group.items)} art.
                    </span>
                  </div>
                  <ul className="divide-border divide-y">
                    {group.items.map((item) => (
                      <li
                        key={item.id}
                        className="flex items-center gap-3 px-4 py-2.5"
                      >
                        <span className="bg-primary-50 text-primary-700 flex h-8 min-w-8 shrink-0 items-center justify-center rounded-[9px] px-1.5 text-[13px] font-bold whitespace-nowrap tabular-nums">
                          {formatQtyUnit(Number(item.quantity), item.unit)}
                        </span>
                        <div className="min-w-0 flex-1">
                          <p className="truncate text-sm font-medium">
                            {item.product_name}
                          </p>
                          {/* Options/variantes choisies — indispensables pour
                              préparer juste (style Uber Eats). */}
                          {(() => {
                            const opts = (
                              item as unknown as {
                                order_item_options?: {
                                  option_name_fr: string;
                                  price_delta_da: number;
                                }[];
                              }
                            ).order_item_options;
                            return opts && opts.length > 0 ? (
                              <p className="text-primary-700 truncate text-xs font-medium">
                                {opts
                                  .map((op) => op.option_name_fr)
                                  .join(" · ")}
                              </p>
                            ) : null;
                          })()}
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
            <div className="border-border space-y-1.5 border-t px-4 py-3 text-sm">
              <Recap label="Sous-total" value={subtotal} />
              {o.service_fee_da > 0 && (
                <Recap label="Frais de service" value={o.service_fee_da} />
              )}
              {o.cashback_da > 0 && (
                <Recap label="Cashback" value={-o.cashback_da} tone="muted" />
              )}
              <div className="flex justify-between font-semibold">
                <span>Total payé par le client</span>
                <span className="tabular-nums">{formatDA(o.total_da)}</span>
              </div>
            </div>
          </section>

          {/* Timeline */}
          <section className="border-border bg-surface rounded-[16px] border p-4">
            <h2 className="mb-3 text-sm font-bold">Suivi</h2>
            <OrderStatusTimeline status={o.status} events={orderEvents} />
          </section>
        </div>

        {/* Colonne droite : remise + gains + actions (le client vit dans le
            héro, toujours visible — plus de carte dédiée). */}
        <div className="space-y-4">
          {/* Retrait OU Livraison : pour la livraison, le code est MASQUÉ
              côté commerçant (cf. PROMPT 9 anti-fraude — le client communique
              son code au livreur, le commerçant ne doit JAMAIS le voir). */}
          {o.fulfillment_type === "delivery" ? (
            <section className="border-warning-200 bg-warning-50 rounded-[16px] border p-4">
              <p className="text-warning-700 mb-2 text-xs font-bold tracking-wide uppercase">
                Livraison
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
                  {o.delivery_distance_km != null &&
                    ` · ${o.delivery_distance_km} km`}
                </p>
              )}
              <p className="text-muted mt-2 flex items-start gap-1.5 text-xs">
                <Lock className="mt-0.5 size-3.5 shrink-0" />
                Code de retrait masqué (sécurité) — le client le donne au
                livreur.
              </p>
            </section>
          ) : (
            /* Remise au client — le n° et le créneau sont déjà dans le héro
               (jamais de doublon d'information) : ici, uniquement la consigne. */
            <section className="border-primary-200 bg-primary-50/60 rounded-[16px] border p-4">
              <p className="text-primary-900/70 text-xs font-bold tracking-wide uppercase">
                Remise au client
              </p>
              <p className="text-foreground mt-1.5 flex items-start gap-1.5 text-sm font-medium">
                {o.payment_method === "online" ? (
                  <Lock className="text-primary-700 mt-0.5 size-4 shrink-0" />
                ) : (
                  <Banknote className="text-primary-700 mt-0.5 size-4 shrink-0" />
                )}
                {o.payment_method === "online"
                  ? "Payé en ligne — demande au client son code à 4 chiffres."
                  : "Cash — encaisse et confirme, aucun code requis."}
              </p>
            </section>
          )}

          {/* Vos gains — le chiffre VRAI, qui réconcilie avec /finances. */}
          <EarningsCard e={earnings} />

          {/* Actions — sticky en bas sur mobile, carte sur desktop */}
          <section className="border-border bg-surface fixed inset-x-0 bottom-[calc(4rem+env(safe-area-inset-bottom))] z-20 border-t p-4 shadow-[0_-4px_12px_rgba(0,0,0,0.04)] lg:static lg:bottom-auto lg:rounded-[16px] lg:border lg:p-5 lg:shadow-none">
            <h2 className="mb-3 hidden text-sm font-bold lg:block">Action</h2>
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

/** Une ligne du détail des gains : libellé + montant signé/coloré. */
function EarnLine({
  label,
  amount,
  sign,
}: {
  label: string;
  amount: number;
  sign: "+" | "−";
}) {
  return (
    <div className="flex items-center justify-between gap-3 py-1.5">
      <span className="text-muted">{label}</span>
      <span
        className={
          "shrink-0 font-semibold tabular-nums " +
          (sign === "+" ? "text-success-700" : "text-danger-600")
        }
      >
        {sign} {formatDA(amount)}
      </span>
    </div>
  );
}

/**
 * Carte « Vos gains » — le chiffre VRAI du commerçant, différencié espèces /
 * en ligne / express, réconcilié avec /finances. REPLIABLE : le net est
 * visible d'un coup d'œil, le détail s'ouvre au tap (pendant la préparation,
 * l'argent est secondaire — moins de scroll).
 */
function EarningsCard({ e }: { e: MerchantOrderEarnings }) {
  const pct =
    e.products > 0 ? Math.round((e.commission / e.products) * 100) : 0;
  return (
    <section className="border-border bg-surface rounded-[16px] border">
      <details className="group">
        <summary className="flex cursor-pointer list-none items-center justify-between gap-2 px-4 py-3.5 [&::-webkit-details-marker]:hidden">
          <span className="flex items-center gap-2 text-sm font-bold">
            <Wallet className="text-primary-500 size-4" />
            Vos gains
            {!e.finalized && <Badge tone="amber">Estimation</Badge>}
          </span>
          <span className="flex items-center gap-1.5">
            <span className="text-success-700 text-base font-extrabold tabular-nums">
              {formatDA(e.net)}
            </span>
            <ChevronDown className="text-subtle size-4 transition-transform group-open:rotate-180" />
          </span>
        </summary>

        <div className="border-border space-y-1 border-t px-4 py-3 text-sm">
          <EarnLine
            label="Produits (votre chiffre d'affaires)"
            amount={e.products}
            sign="+"
          />
          <EarnLine
            label={`Commission Coligo${pct > 0 ? ` (${pct} %)` : ""}`}
            amount={e.commission}
            sign="−"
          />
          {e.paymentMethod === "online" && e.isTour && e.deliveryFee > 0 && (
            <EarnLine
              label="Livraison tournée encaissée"
              amount={e.deliveryFee}
              sign="+"
            />
          )}
          {e.tourCommission > 0 && (
            <EarnLine
              label="Commission livraison (tournée)"
              amount={e.tourCommission}
              sign="−"
            />
          )}
        </div>

        {/* Comment l'argent vous arrive — selon le mode de paiement */}
        <div className="border-border text-muted border-t px-4 py-3 text-xs leading-relaxed">
          {e.isCodExpress ? (
            <p>
              <Truck className="me-1 inline size-3.5 align-[-2px]" />
              <strong>Livraison express.</strong> Le livreur vous a avancé le
              montant des produits au retrait — la commission est réglée via
              lui, rien n&apos;est prélevé sur votre solde.
            </p>
          ) : e.paymentMethod === "cash" ? (
            <p>
              <Banknote className="me-1 inline size-3.5 align-[-2px]" />
              <strong>Payé en espèces.</strong> Vous avez encaissé{" "}
              <strong className="text-foreground">
                {formatDA(e.cashCollected ?? 0)}
              </strong>{" "}
              en main. À régler à Coligo :{" "}
              <strong className="text-foreground">
                {formatDA(e.owedToColigo ?? 0)}
              </strong>{" "}
              (prélevé sur votre solde Coligo Pay).
              {e.redeemed > 0 && (
                <>
                  {" "}
                  Dont {formatDA(e.redeemed)} de cashback / Coligo Pay du client
                  qui vous sont reversés.
                </>
              )}
            </p>
          ) : (
            <p>
              <Lock className="me-1 inline size-3.5 align-[-2px]" />
              <strong>Payé en ligne.</strong>{" "}
              <strong className="text-foreground">
                {formatDA(e.walletImpact)}
              </strong>{" "}
              ont été crédités sur votre solde Coligo Pay (commission déjà
              déduite). Les frais de service et la livraison ne sont pas pour
              vous.
            </p>
          )}
        </div>
      </details>
    </section>
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
