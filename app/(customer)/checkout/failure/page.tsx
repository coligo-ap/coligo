import { redirect } from "next/navigation";
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
  // Pas d'order_id (lien tronqué, retour Chargily inattendu) → on n'envoie PAS
  // vers une 404 : page de retour de paiement = jamais de cul-de-sac.
  if (!order_id) return <FailureFallback />;

  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) {
    // `next` encodé pour préserver l'order_id à travers la connexion.
    const next = encodeURIComponent(`/checkout/failure?order_id=${order_id}`);
    redirect(`/se-connecter?next=${next}`);
  }

  const { data: order } = await supabase
    .from("orders")
    .select(
      "id, status, pickup_code, payment_status, total_da, payment_method, payment_failure_reason"
    )
    .eq("id", order_id)
    .maybeSingle();
  // Commande illisible (RLS, autre compte connecté, déjà purgée) → fallback
  // amical plutôt qu'une 404.
  if (!order) return <FailureFallback />;

  // Si le webhook a déjà confirmé le paiement entre-temps (race rare), on
  // bascule sur la page de succès.
  if (order.payment_status === "paid") {
    redirect(`/checkout/success?order_id=${order.id}`);
  }

  const reason = humanizeFailureReason(order.payment_failure_reason);

  // Si la commande est encore `pending` côté DB (webhook pas encore arrivé),
  // on autorise quand même le retry. Si elle est définitivement annulée
  // (status='cancelled' via webhook), on n'autorise PAS le retry sur cette
  // commande-là : le client doit repasser via son panier (qui est intact).
  const orderCancelled =
    order.status === "cancelled" || order.payment_status === "failed";
  const canRetryThisOrder =
    !orderCancelled && order.payment_method === "online" && order.total_da > 0;

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

        <div className="border-primary-100 bg-primary-50 text-primary-800 mt-5 rounded-[12px] border px-4 py-3 text-sm">
          <p className="font-semibold">Ton panier est intact 🛒</p>
          <p className="text-primary-700 mt-1 text-xs">
            Tu peux retourner au checkout, modifier ta commande ou changer le
            mode de paiement (espèces au retrait).
          </p>
        </div>

        <div className="mt-6 flex flex-col gap-2">
          <Link
            href="/checkout"
            className="bg-primary-600 hover:bg-primary-700 inline-flex h-11 items-center justify-center rounded-[12px] px-5 text-sm font-semibold text-white"
          >
            Retourner au checkout
          </Link>
          {canRetryThisOrder && <CheckoutRetryButton orderId={order.id} />}
          <Link
            href="/"
            className="text-muted hover:text-foreground text-sm hover:underline"
          >
            Retour à l&apos;accueil
          </Link>
        </div>

        <p className="text-subtle mt-6 text-xs">
          Aucun débit n&apos;a eu lieu. Cette commande n&apos;apparaît PAS dans
          « Mes commandes » tant qu&apos;elle n&apos;est pas payée.
        </p>
      </div>
    </CustomerShell>
  );
}

/** Repli quand on n'a pas le contexte commande (jamais de 404 sur un retour
 *  de paiement). */
function FailureFallback() {
  return (
    <CustomerShell>
      <div className="mx-auto max-w-md px-4 py-12 text-center lg:py-20">
        <div className="bg-danger-50 text-danger-700 mx-auto flex size-16 items-center justify-center rounded-full">
          <XCircle className="size-8" />
        </div>
        <h1 className="text-foreground mt-4 text-2xl font-bold">
          Paiement non abouti
        </h1>
        <p className="text-muted mt-2 text-sm">
          Ton paiement n&apos;a pas été confirmé. Aucun débit n&apos;a eu lieu
          et ton panier est intact.
        </p>
        <div className="mt-6 flex flex-col gap-2">
          <Link
            href="/checkout"
            className="bg-primary-600 hover:bg-primary-700 inline-flex h-11 items-center justify-center rounded-[12px] px-5 text-sm font-semibold text-white"
          >
            Retourner au checkout
          </Link>
          <Link
            href="/commandes"
            className="text-muted hover:text-foreground text-sm hover:underline"
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
