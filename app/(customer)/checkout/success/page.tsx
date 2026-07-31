import { redirect } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { CheckCircle2, Clock } from "lucide-react";
import { CustomerShell } from "@/components/customer/customer-shell";
import { createClient } from "@/lib/supabase/server";
import { CheckoutPaymentWatcher } from "@/components/customer/checkout-payment-watcher";
import { ClearCartOnMount } from "@/components/customer/clear-cart-on-mount";
import { OrderCelebrationDecor } from "@/components/customer/order-celebration";
import { OrderPurchaseTracking } from "@/components/analytics/order-purchase-tracking";

export const dynamic = "force-dynamic";

// =============================================================================
// /checkout/success — page de retour APRÈS Chargily redirige le client.
// ⚠️ Cette page ne FAIT PAS foi sur la confirmation du paiement : seul le
// webhook le fait. On affiche un état d'attente et on poll côté client jusqu'à
// `payment_status = paid` (puis redirection vers /commandes/:id).
// =============================================================================
export default async function CheckoutSuccessPage({
  searchParams,
}: {
  searchParams: Promise<{ order_id?: string }>;
}) {
  const { order_id } = await searchParams;
  if (!order_id) return await SuccessFallback();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    const next = encodeURIComponent(`/checkout/success?order_id=${order_id}`);
    redirect(`/se-connecter?next=${next}`);
  }

  const { data: order } = await supabase
    .from("orders")
    .select(
      `id, status, pickup_code, payment_status, total_da, delivery_fee_da, payment_method, customer_id, created_at,
       merchants ( name ),
       order_items ( product_name, unit_price_da, quantity )`
    )
    .eq("id", order_id)
    .maybeSingle();
  // Commande illisible → on ne bloque pas en 404 : message rassurant + lien.
  if (!order) return await SuccessFallback();

  const t = await getTranslations("checkout");

  // On bascule vers la page d'échec dédiée (panier conservé + réessai) dans
  // DEUX cas :
  //  1. Chargily a notifié `failed`/`canceled`/`expired` → commande déjà
  //     cancelled/failed (webhook).
  //  2. Commande ONLINE restée `pending` BIEN au-delà du temps d'un paiement
  //     (abandon) : le webhook `paid` est quasi instantané, donc un `pending`
  //     après ce délai = paiement jamais complété. Sans ça, /checkout/success
  //     affichait « paiement en cours de confirmation » À L'INFINI (même en
  //     actualisant), alors que rien n'arrivera plus (bug prod 01/07). Le filet
  //     serveur (mig 0295) finit d'annuler + rembourser côté base.
  const STALE_UNPAID_MIN = 25;
  const staleUnpaidOnline =
    order.payment_method === "online" &&
    order.payment_status !== "paid" &&
    Date.now() - new Date(order.created_at as string).getTime() >
      STALE_UNPAID_MIN * 60_000;
  if (
    order.status === "cancelled" ||
    order.payment_status === "failed" ||
    staleUnpaidOnline
  ) {
    redirect(`/checkout/failure?order_id=${order.id}`);
  }

  return (
    <CustomerShell>
      <div className="mx-auto max-w-md px-4 py-12 text-center lg:py-20">
        {order.payment_status === "paid" ? (
          <>
            {/* GA4 — purchase (payé en ligne). Le client s'arrête souvent ICI
                sans ouvrir le détail → on compte la vente sur la page « payé ».
                Dédup par orderId : pas de double-comptage si le client ouvre
                ensuite /commandes/[id]. */}
            <OrderPurchaseTracking
              orderId={order.id}
              status={order.status}
              valueDa={order.total_da}
              shippingDa={
                (order as { delivery_fee_da: number | null }).delivery_fee_da ??
                0
              }
              merchantName={
                (order as unknown as { merchants: { name: string } | null })
                  .merchants?.name ?? null
              }
              lines={(
                (
                  order as unknown as {
                    order_items: {
                      product_name: string;
                      unit_price_da: number;
                      quantity: number;
                    }[];
                  }
                ).order_items ?? []
              ).map((it) => ({
                id: it.product_name,
                name: it.product_name,
                unitPriceDa: it.unit_price_da,
                quantity: it.quantity,
              }))}
            />
            <Paid pickupCode={order.pickup_code} orderId={order.id} t={t} />
          </>
        ) : (
          <PendingConfirmation
            orderId={order.id}
            pickupCode={order.pickup_code}
            t={t}
          />
        )}
      </div>
    </CustomerShell>
  );
}

type Translator = Awaited<ReturnType<typeof getTranslations>>;

function Paid({
  pickupCode,
  orderId,
  t,
}: {
  pickupCode: string;
  orderId: string;
  t: Translator;
}) {
  return (
    <>
      <ClearCartOnMount />
      {/* Fête « paiement accepté » — même langage que la Roue et le panier
          partagé (confettis + boom, reduced-motion respecté). */}
      <OrderCelebrationDecor title={t("paidTitle")} />
      <p className="text-muted mt-2 text-sm">{t("paidSubtitle")}</p>
      <p className="text-primary-700 mt-4 text-4xl font-bold tracking-widest tabular-nums">
        {pickupCode}
      </p>
      <Link
        href={`/commandes/${orderId}`}
        className="bg-primary-600 hover:bg-primary-700 mt-6 inline-flex rounded-[12px] px-5 py-2.5 text-sm font-medium text-white"
      >
        {t("viewOrderDetail")}
      </Link>
    </>
  );
}

function PendingConfirmation({
  orderId,
  pickupCode,
  t,
}: {
  orderId: string;
  pickupCode: string;
  t: Translator;
}) {
  return (
    <>
      <div className="bg-warning-50 text-warning-700 mx-auto flex size-16 items-center justify-center rounded-full">
        <Clock className="size-8 animate-pulse" />
      </div>
      <h1 className="text-foreground mt-4 text-2xl font-bold">
        {t("pendingTitle")}
      </h1>
      <p className="text-muted mt-2 text-sm">{t("pendingSubtitle")}</p>
      <p className="text-primary-700 mt-4 text-4xl font-bold tracking-widest tabular-nums">
        {pickupCode}
      </p>
      <CheckoutPaymentWatcher orderId={orderId} />
      <Link
        href={`/commandes/${orderId}`}
        className="text-primary-700 mt-6 inline-flex text-sm font-medium hover:underline"
      >
        {t("viewOrderNow")}
      </Link>
    </>
  );
}

/** Repli sans contexte commande — jamais de 404 sur un retour de paiement. */
async function SuccessFallback() {
  const t = await getTranslations("checkout");
  return (
    <CustomerShell>
      <div className="mx-auto max-w-md px-4 py-12 text-center lg:py-20">
        <div className="bg-success-100 text-success-700 mx-auto flex size-16 items-center justify-center rounded-full">
          <CheckCircle2 className="size-8" />
        </div>
        <h1 className="text-foreground mt-4 text-2xl font-bold">
          {t("thanks")}
        </h1>
        <p className="text-muted mt-2 text-sm">{t("successFallbackBody")}</p>
        <div className="mt-6 flex flex-col gap-2">
          <Link
            href="/commandes"
            className="bg-primary-600 hover:bg-primary-700 inline-flex h-11 items-center justify-center rounded-[12px] px-5 text-sm font-semibold text-white"
          >
            {t("viewMyOrders")}
          </Link>
          <Link
            href="/"
            className="text-muted hover:text-foreground text-sm hover:underline"
          >
            {t("backHome")}
          </Link>
        </div>
      </div>
    </CustomerShell>
  );
}
