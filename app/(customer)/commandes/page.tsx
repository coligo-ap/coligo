import Link from "next/link";
import { redirect } from "next/navigation";
import { Receipt } from "lucide-react";
import { CustomerShell } from "@/components/customer/customer-shell";
import { createClient } from "@/lib/supabase/server";
import type { OrderStatus } from "@/lib/types";
import {
  CustomerOrdersTabs,
  type CustomerOrderRow,
} from "@/components/customer/customer-orders-tabs";

export const dynamic = "force-dynamic";

export default async function CustomerOrdersListPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) redirect("/se-connecter?next=/commandes");

  const { data: customer } = await supabase
    .from("customers")
    .select("id")
    .eq("user_id", user.id)
    .maybeSingle();
  if (!customer) redirect("/se-connecter");

  // RLS filtre déjà sur customer_id (policy orders_select_own_customer).
  // On joint le merchant pour afficher le nom.
  //
  // ⚠️ FILTRE UX : on EXCLUT les commandes online jamais confirmées (pending
  // ou failed). Tant que Chargily n'a pas confirmé le paiement, la commande
  // n'existe pas du point de vue du client. S'il abandonne ou échoue, la
  // commande est annulée côté serveur (webhook → status='cancelled') et son
  // panier reste intact côté navigateur pour qu'il puisse repasser commande.
  const { data: orders } = await supabase
    .from("orders")
    .select(
      `id, status, payment_method, payment_status, total_da, pickup_code, order_number,
       pickup_slot_at, created_at, merchant_id, fulfillment_type,
       merchants ( name, slug, logo_url )`
    )
    .eq("customer_id", customer.id)
    .or(
      "payment_method.eq.cash,and(payment_method.eq.online,payment_status.eq.paid)"
    )
    .order("created_at", { ascending: false })
    .limit(100);

  const rows = orders ?? [];

  // Pré-charge les order_ids déjà notés, pour le bouton "Laisser un avis".
  const completedIds = rows
    .filter((o) => o.status === "completed")
    .map((o) => o.id);
  let reviewedIds = new Set<string>();
  if (completedIds.length > 0) {
    const { data: reviews } = await supabase
      .from("reviews")
      .select("order_id")
      .in("order_id", completedIds);
    reviewedIds = new Set((reviews ?? []).map((r) => r.order_id));
  }

  const mapped: CustomerOrderRow[] = rows.map((o) => {
    const merchant = (
      o as unknown as {
        merchants: { name: string; logo_url: string | null } | null;
      }
    ).merchants;
    return {
      id: o.id,
      status: o.status as OrderStatus,
      payment_method: o.payment_method,
      payment_status: o.payment_status,
      total_da: o.total_da,
      pickup_code: o.pickup_code,
      order_number: o.order_number ?? null,
      created_at: o.created_at,
      fulfillment_type:
        (o.fulfillment_type as "pickup" | "delivery") ?? "pickup",
      merchant_name: merchant?.name ?? "Commerce",
      merchant_logo: merchant?.logo_url ?? null,
      reviewed: reviewedIds.has(o.id),
    };
  });

  return (
    <CustomerShell>
      <div className="mx-auto max-w-3xl px-4 py-4 lg:px-6 lg:py-8">
        <header className="mb-5">
          <h1 className="text-foreground text-2xl font-bold lg:text-3xl">
            Mes commandes
          </h1>
          <p className="text-muted text-sm">
            Historique et commandes en cours.
          </p>
        </header>

        {mapped.length === 0 ? (
          <div className="border-border bg-surface mx-auto max-w-md rounded-[16px] border p-10 text-center">
            <Receipt className="text-primary-500 mx-auto size-10" />
            <p className="text-foreground mt-3 text-sm font-semibold">
              Tu n&apos;as pas encore commandé
            </p>
            <p className="text-muted mt-1 text-xs">
              Découvre les commerces autour de toi et passe ta première
              commande.
            </p>
            <Link
              href="/"
              className="bg-primary-600 hover:bg-primary-700 mt-4 inline-flex rounded-[10px] px-4 py-2 text-sm font-medium text-white"
            >
              Voir les commerces
            </Link>
          </div>
        ) : (
          <CustomerOrdersTabs orders={mapped} />
        )}
      </div>
    </CustomerShell>
  );
}
