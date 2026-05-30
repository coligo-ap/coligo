import { redirect } from "next/navigation";
import Link from "next/link";
import { CheckCircle2, Clock } from "lucide-react";
import { CustomerShell } from "@/components/customer/customer-shell";
import { createClient } from "@/lib/supabase/server";
import { CheckoutPaymentWatcher } from "@/components/customer/checkout-payment-watcher";
import { ClearCartOnMount } from "@/components/customer/clear-cart-on-mount";

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
  if (!order_id) return <SuccessFallback />;

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
      "id, status, pickup_code, payment_status, total_da, payment_method, customer_id"
    )
    .eq("id", order_id)
    .maybeSingle();
  // Commande illisible → on ne bloque pas en 404 : message rassurant + lien.
  if (!order) return <SuccessFallback />;

  // Race : si Chargily a notifié `failed` pendant que le client revenait
  // sur success_url, la commande est déjà cancelled. On redirige vers la
  // page d'échec (qui expliquera la raison côté UX).
  if (order.status === "cancelled" || order.payment_status === "failed") {
    redirect(`/checkout/failure?order_id=${order.id}`);
  }

  return (
    <CustomerShell>
      <div className="mx-auto max-w-md px-4 py-12 text-center lg:py-20">
        {order.payment_status === "paid" ? (
          <Paid pickupCode={order.pickup_code} orderId={order.id} />
        ) : (
          <PendingConfirmation
            orderId={order.id}
            pickupCode={order.pickup_code}
          />
        )}
      </div>
    </CustomerShell>
  );
}

function Paid({
  pickupCode,
  orderId,
}: {
  pickupCode: string;
  orderId: string;
}) {
  return (
    <>
      <ClearCartOnMount />
      <div className="bg-success-100 text-success-700 mx-auto flex size-16 items-center justify-center rounded-full">
        <CheckCircle2 className="size-8" />
      </div>
      <h1 className="text-foreground mt-4 text-2xl font-bold">
        Paiement confirmé
      </h1>
      <p className="text-muted mt-2 text-sm">
        Ta commande est enregistrée. Présente ce code au retrait :
      </p>
      <p className="text-primary-700 mt-4 text-4xl font-bold tracking-widest tabular-nums">
        {pickupCode}
      </p>
      <Link
        href={`/commandes/${orderId}`}
        className="bg-primary-600 hover:bg-primary-700 mt-6 inline-flex rounded-[12px] px-5 py-2.5 text-sm font-medium text-white"
      >
        Voir le détail de la commande
      </Link>
    </>
  );
}

function PendingConfirmation({
  orderId,
  pickupCode,
}: {
  orderId: string;
  pickupCode: string;
}) {
  return (
    <>
      <div className="bg-warning-50 text-warning-700 mx-auto flex size-16 items-center justify-center rounded-full">
        <Clock className="size-8 animate-pulse" />
      </div>
      <h1 className="text-foreground mt-4 text-2xl font-bold">
        Paiement en cours de confirmation…
      </h1>
      <p className="text-muted mt-2 text-sm">
        On attend la confirmation de Chargily Pay (quelques secondes). Garde
        cette page ouverte — tu seras redirigé(e) automatiquement dès que
        c&apos;est bon.
      </p>
      <p className="text-primary-700 mt-4 text-4xl font-bold tracking-widest tabular-nums">
        {pickupCode}
      </p>
      <CheckoutPaymentWatcher orderId={orderId} />
      <Link
        href={`/commandes/${orderId}`}
        className="text-primary-700 mt-6 inline-flex text-sm font-medium hover:underline"
      >
        Voir ma commande sans attendre →
      </Link>
    </>
  );
}

/** Repli sans contexte commande — jamais de 404 sur un retour de paiement. */
function SuccessFallback() {
  return (
    <CustomerShell>
      <div className="mx-auto max-w-md px-4 py-12 text-center lg:py-20">
        <div className="bg-success-100 text-success-700 mx-auto flex size-16 items-center justify-center rounded-full">
          <CheckCircle2 className="size-8" />
        </div>
        <h1 className="text-foreground mt-4 text-2xl font-bold">Merci !</h1>
        <p className="text-muted mt-2 text-sm">
          Si ton paiement a été confirmé, ta commande apparaît dans « Mes
          commandes » avec son code de retrait.
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <Link
            href="/commandes"
            className="bg-primary-600 hover:bg-primary-700 inline-flex h-11 items-center justify-center rounded-[12px] px-5 text-sm font-semibold text-white"
          >
            Voir mes commandes
          </Link>
          <Link
            href="/"
            className="text-muted hover:text-foreground text-sm hover:underline"
          >
            Retour à l&apos;accueil
          </Link>
        </div>
      </div>
    </CustomerShell>
  );
}
