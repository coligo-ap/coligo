import { redirect, notFound } from "next/navigation";
import Link from "next/link";
import { XCircle } from "lucide-react";
import { CustomerShell } from "@/components/customer/customer-shell";
import { createClient } from "@/lib/supabase/server";
import { CheckoutRetryButton } from "@/components/customer/checkout-retry-button";
import { humanizeFailureReason } from "@/lib/payments/failure-reason";

export const dynamic = "force-dynamic";

// =============================================================================
// /checkout/failure — page de retour APRÈS un paiement échoué/abandonné.
// La commande reste en `payment_status = pending` (ou 'failed' si Chargily
// nous a déjà notifiés via webhook). Le client peut réessayer : on appelle
// `retryOnlineOrderPayment` qui recrée un checkout Chargily pour la MÊME
// commande (idempotent via client_operation_id).
// =============================================================================
export default async function CheckoutFailurePage({
  searchParams,
}: {
  searchParams: Promise<{ order_id?: string }>;
}) {
  const { order_id } = await searchParams;
  if (!order_id) notFound();

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user)
    redirect(`/se-connecter?next=/checkout/failure?order_id=${order_id}`);

  const { data: order } = await supabase
    .from("orders")
    .select(
      "id, pickup_code, payment_status, total_da, payment_method, payment_failure_reason"
    )
    .eq("id", order_id)
    .maybeSingle();
  if (!order) notFound();

  // Si le webhook a déjà confirmé le paiement entre-temps (race rare), on
  // bascule sur la page de succès.
  if (order.payment_status === "paid") {
    redirect(`/checkout/success?order_id=${order.id}`);
  }

  const canRetry =
    order.payment_method === "online" &&
    order.total_da > 0 &&
    order.payment_status !== "refunded";

  const reason = humanizeFailureReason(order.payment_failure_reason);

  return (
    <CustomerShell>
      <div className="mx-auto max-w-md px-4 py-12 text-center lg:py-20">
        <div className="bg-danger-50 text-danger-700 mx-auto flex size-16 items-center justify-center rounded-full">
          <XCircle className="size-8" />
        </div>
        <h1 className="text-foreground mt-4 text-2xl font-bold">
          {reason.title}
        </h1>
        {reason.hint && (
          <p className="text-muted mt-2 text-sm">{reason.hint}</p>
        )}
        <p className="text-muted mt-3 text-xs">
          Commande <span className="font-semibold">#{order.pickup_code}</span>{" "}
          conservée dans ton historique.
        </p>

        <div className="mt-6 flex flex-col gap-2">
          {canRetry && <CheckoutRetryButton orderId={order.id} />}
          <Link
            href={`/commandes/${order.id}`}
            className="text-muted hover:text-foreground text-sm hover:underline"
          >
            Voir ma commande
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
