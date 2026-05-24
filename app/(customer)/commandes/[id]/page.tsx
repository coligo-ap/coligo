import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import {
  ArrowLeft,
  Banknote,
  Check,
  Clock,
  MapPin,
  Sparkles,
} from "lucide-react";
import { CustomerShell } from "@/components/customer/customer-shell";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { ORDER_FLOW, ORDER_STATUS_META, type OrderStatus } from "@/lib/types";
import { cn, formatDA } from "@/lib/utils";
import { OrderQr } from "@/components/customer/order-qr";
import { CustomerOrderLive } from "@/components/customer/customer-order-live";
import { cldUrl } from "@/lib/images/cloudinary";

export const dynamic = "force-dynamic";

export default async function CustomerOrderDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect(`/se-connecter?next=/commandes/${id}`);

  const { data: order } = await supabase
    .from("orders")
    .select(
      `id, status, payment_method, payment_status, pickup_code, pickup_type,
       pickup_slot_at, pickup_slot_start, pickup_slot_end, customer_note,
       subtotal_da, discount_da, cashback_estimate_da, total_da, created_at,
       merchant_id,
       merchants ( name, slug, logo_url, phone_public, address, commune ),
       order_items ( id, product_name, unit_price_da, quantity, line_total_da )`
    )
    .eq("id", id)
    .maybeSingle();

  if (!order) notFound();

  const merchant = (
    order as unknown as {
      merchants: {
        name: string;
        slug: string;
        logo_url: string | null;
        phone_public: string | null;
        address: string | null;
        commune: string | null;
      };
    }
  ).merchants;

  const items =
    (
      order as unknown as {
        order_items: {
          id: string;
          product_name: string;
          unit_price_da: number;
          quantity: number;
          line_total_da: number;
        }[];
      }
    ).order_items ?? [];

  const status = order.status as OrderStatus;
  const meta = ORDER_STATUS_META[status];
  const isCash = order.payment_method === "cash";
  const isOnlinePending =
    order.payment_method === "online" && order.payment_status === "pending";

  return (
    <CustomerShell>
      <div className="mx-auto max-w-2xl px-4 py-4 pb-24 lg:px-6 lg:py-8">
        <Link
          href="/commandes"
          className="text-muted hover:text-foreground mb-3 inline-flex items-center gap-1.5 text-sm"
        >
          <ArrowLeft className="size-4" />
          Mes commandes
        </Link>

        {/* Confirmation */}
        <div className="from-success-500 to-success-600 mb-5 rounded-[20px] bg-gradient-to-br p-6 text-white shadow-md">
          <Check className="size-8" />
          <h1 className="mt-2 text-2xl leading-tight font-bold">
            Commande confirmée !
          </h1>
          <p className="mt-1 text-sm text-white/85">
            Montre ce code au commerçant lors du retrait.
          </p>
        </div>

        {/* Suivi live (Realtime + auto-refresh) */}
        <CustomerOrderLive orderId={order.id} initialStatus={status} />

        {/* Code retrait + QR */}
        <div className="border-border bg-surface mb-5 rounded-[20px] border p-6 text-center shadow-sm">
          <p className="text-muted text-xs font-semibold tracking-wider uppercase">
            Code de retrait
          </p>
          <p className="text-foreground mt-1 text-5xl font-bold tracking-[0.2em] tabular-nums lg:text-6xl">
            {order.pickup_code}
          </p>
          <div className="mt-4 flex justify-center">
            <OrderQr value={order.pickup_code} />
          </div>
        </div>

        {/* Bloc commerce */}
        <div className="border-border bg-surface mb-5 rounded-[16px] border p-5">
          <div className="flex items-center gap-3">
            {merchant.logo_url ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={
                  cldUrl(merchant.logo_url, {
                    width: 96,
                    height: 96,
                    crop: "fill",
                    gravity: "auto",
                  }) ?? merchant.logo_url
                }
                alt=""
                loading="lazy"
                decoding="async"
                className="border-border size-12 rounded-full border bg-white object-cover"
              />
            ) : (
              <div className="bg-primary-100 text-primary-700 flex size-12 items-center justify-center rounded-full text-base font-bold">
                {merchant.name.charAt(0)}
              </div>
            )}
            <div className="min-w-0 flex-1">
              <p className="text-foreground line-clamp-1 text-base font-semibold">
                {merchant.name}
              </p>
              <p className="text-muted text-xs">
                <MapPin className="-mt-0.5 mr-1 inline size-3" />
                {[merchant.address, merchant.commune]
                  .filter(Boolean)
                  .join(" · ") || "—"}
              </p>
            </div>
            <Link
              href={`/m/${merchant.slug}`}
              className="text-primary-700 text-xs font-medium hover:underline"
            >
              Voir
            </Link>
          </div>
        </div>

        {/* Récap */}
        <div className="border-border bg-surface mb-5 rounded-[16px] border p-5">
          <h2 className="text-foreground mb-3 text-base font-semibold">
            Détail de la commande
          </h2>
          <ul className="divide-border divide-y">
            {items.map((it) => (
              <li
                key={it.id}
                className="flex items-center justify-between gap-3 py-2.5 text-sm"
              >
                <span className="text-foreground line-clamp-1">
                  {it.quantity}× {it.product_name}
                </span>
                <span className="text-foreground tabular-nums">
                  {formatDA(it.line_total_da)}
                </span>
              </li>
            ))}
          </ul>

          <dl className="border-border mt-3 space-y-1.5 border-t pt-3 text-sm">
            <Row label="Sous-total" value={formatDA(order.subtotal_da)} />
            {order.discount_da > 0 && (
              <Row
                label="Promo"
                value={`− ${formatDA(order.discount_da)}`}
                tone="success"
              />
            )}
            {order.cashback_estimate_da > 0 && (
              <Row
                label="Cashback estimé"
                value={`+ ${formatDA(order.cashback_estimate_da)}`}
                tone="primary"
              />
            )}
            <div className="border-border mt-2 border-t pt-2" />
            <Row
              label={
                isCash
                  ? "À payer en espèces"
                  : isOnlinePending
                    ? "En attente de paiement"
                    : "Payé en ligne"
              }
              value={formatDA(order.total_da)}
              bold
            />
          </dl>
        </div>

        {/* Mode + créneau */}
        <div className="grid gap-3 sm:grid-cols-2">
          <Info icon={Clock} title="Retrait">
            {order.pickup_type === "slot" && order.pickup_slot_start ? (
              <>
                Créneau{" "}
                {new Date(order.pickup_slot_start).toLocaleTimeString("fr-DZ", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
                {order.pickup_slot_end &&
                  ` – ${new Date(order.pickup_slot_end).toLocaleTimeString(
                    "fr-DZ",
                    { hour: "2-digit", minute: "2-digit" }
                  )}`}
              </>
            ) : (
              <>
                Dès que prêt — vers{" "}
                {new Date(order.pickup_slot_at).toLocaleTimeString("fr-DZ", {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
              </>
            )}
          </Info>
          <Info icon={isCash ? Banknote : Sparkles} title="Paiement">
            {isCash ? (
              "Espèces au retrait"
            ) : order.payment_status === "paid" ? (
              <span className="text-success-700 font-semibold">
                Payé en ligne
              </span>
            ) : order.payment_status === "failed" ? (
              <span className="text-danger-700 font-semibold">
                Paiement échoué
              </span>
            ) : (
              "En ligne"
            )}
            {isOnlinePending && (
              <span className="text-warning-700 mt-0.5 block text-xs">
                En attente de confirmation Chargily…
              </span>
            )}
          </Info>
        </div>

        {order.customer_note && (
          <p className="text-muted bg-surface-2 mt-3 rounded-[12px] px-3 py-2 text-xs">
            Note : {order.customer_note}
          </p>
        )}

        {/* Timeline statut */}
        <section className="border-border bg-surface mt-5 rounded-[16px] border p-5">
          <h2 className="text-foreground mb-3 text-sm font-semibold">
            Suivi de ta commande
          </h2>
          <ol className="space-y-2 text-sm">
            {ORDER_FLOW.map((step, idx) => {
              const currentIdx = ORDER_FLOW.findIndex(
                (s) => s.status === status
              );
              const reached = currentIdx >= 0 && idx <= currentIdx;
              const active = currentIdx === idx;
              return (
                <li
                  key={step.status}
                  className={cn(
                    "flex items-center gap-3",
                    reached ? "text-foreground" : "text-subtle"
                  )}
                >
                  <span
                    className={cn(
                      "flex size-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold",
                      reached
                        ? "bg-success-500 text-white"
                        : "bg-surface-3 text-muted"
                    )}
                  >
                    {reached ? <Check className="size-3.5" /> : idx + 1}
                  </span>
                  <span className={cn("flex-1", active && "font-semibold")}>
                    {step.label}
                  </span>
                  {active && <Badge tone={meta.tone}>{meta.label}</Badge>}
                </li>
              );
            })}
          </ol>
        </section>
      </div>
    </CustomerShell>
  );
}

function Info({
  icon: Icon,
  title,
  children,
}: {
  icon: React.ComponentType<{ className?: string }>;
  title: string;
  children: React.ReactNode;
}) {
  return (
    <div className="border-border bg-surface rounded-[14px] border p-4">
      <div className="text-muted mb-1 flex items-center gap-1.5 text-xs font-medium">
        <Icon className="size-3.5" />
        {title}
      </div>
      <div className="text-foreground text-sm">{children}</div>
    </div>
  );
}

function Row({
  label,
  value,
  bold,
  tone,
}: {
  label: string;
  value: string;
  bold?: boolean;
  tone?: "success" | "primary";
}) {
  return (
    <div className="flex items-center justify-between">
      <dt
        className={cn(
          "text-muted",
          bold && "text-foreground text-sm font-semibold"
        )}
      >
        {label}
      </dt>
      <dd
        className={cn(
          "tabular-nums",
          bold ? "text-foreground text-base font-bold" : "text-foreground",
          tone === "success" && "text-success-700 font-semibold",
          tone === "primary" && "text-primary-700 font-semibold"
        )}
      >
        {value}
      </dd>
    </div>
  );
}
