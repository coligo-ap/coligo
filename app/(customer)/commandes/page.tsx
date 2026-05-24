import Link from "next/link";
import { redirect } from "next/navigation";
import { Banknote, CreditCard, Hourglass, Receipt } from "lucide-react";
import { CustomerShell } from "@/components/customer/customer-shell";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { ORDER_STATUS_META, type OrderStatus } from "@/lib/types";
import { cn, formatDA } from "@/lib/utils";
import { cldUrl } from "@/lib/images/cloudinary";

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
  const { data: orders } = await supabase
    .from("orders")
    .select(
      `id, status, payment_method, payment_status, total_da, pickup_code,
       pickup_slot_at, created_at, merchant_id,
       merchants ( name, slug, logo_url )`
    )
    .eq("customer_id", customer.id)
    .order("created_at", { ascending: false })
    .limit(100);

  const rows = orders ?? [];

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

        {rows.length === 0 ? (
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
          <ul className="space-y-2.5">
            {rows.map((o) => {
              const meta = ORDER_STATUS_META[o.status as OrderStatus];
              const merchant = (
                o as unknown as {
                  merchants: {
                    name: string;
                    slug: string;
                    logo_url: string | null;
                  };
                }
              ).merchants;
              const date = new Date(o.created_at).toLocaleDateString("fr-DZ", {
                day: "numeric",
                month: "short",
                hour: "2-digit",
                minute: "2-digit",
              });
              return (
                <li key={o.id}>
                  <Link
                    href={`/commandes/${o.id}`}
                    className="border-border bg-surface hover:border-primary-300 flex items-center gap-3 rounded-[14px] border p-4 transition"
                  >
                    {merchant?.logo_url ? (
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
                        className="border-border size-12 shrink-0 rounded-full border bg-white object-cover"
                      />
                    ) : (
                      <div className="bg-primary-100 text-primary-700 flex size-12 shrink-0 items-center justify-center rounded-full text-base font-bold">
                        {(merchant?.name ?? "?").charAt(0)}
                      </div>
                    )}
                    <div className="min-w-0 flex-1">
                      <p className="text-foreground line-clamp-1 text-sm font-semibold">
                        {merchant?.name ?? "Commerce"}
                      </p>
                      <p className="text-muted text-xs">
                        {date} · Code {o.pickup_code}
                      </p>
                    </div>
                    <div className="flex flex-col items-end gap-1">
                      <span className="text-foreground text-sm font-bold tabular-nums">
                        {formatDA(o.total_da)}
                      </span>
                      <Badge tone={meta.tone}>{meta.label}</Badge>
                      <PaymentBadge
                        method={o.payment_method}
                        status={o.payment_status}
                      />
                    </div>
                  </Link>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </CustomerShell>
  );
}

// =============================================================================
// PaymentBadge — montre le mode de paiement + son état.
//   - cash + pending          → "Espèces au retrait"
//   - cash + paid             → "Espèces payé"   (rare : trigger sur completed)
//   - online + pending        → "Paiement en attente" (orange — Chargily pas
//                                encore confirmé OU lien jamais finalisé)
//   - online + paid           → "Payé en ligne" (vert)
//   - online + failed         → "Paiement échoué" (rouge)
//   - * + refunded            → "Remboursé"
// =============================================================================
function PaymentBadge({
  method,
  status,
}: {
  method: "cash" | "online";
  status: "pending" | "paid" | "failed" | "refunded";
}) {
  if (method === "cash") {
    return (
      <span className="text-muted inline-flex items-center gap-1 text-[11px]">
        <Banknote className="size-3" />
        Espèces au retrait
      </span>
    );
  }
  // online
  if (status === "paid") {
    return (
      <span className="text-success-700 inline-flex items-center gap-1 text-[11px] font-semibold">
        <CreditCard className="size-3" />
        Payé en ligne
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span className="text-danger-700 inline-flex items-center gap-1 text-[11px] font-semibold">
        <CreditCard className="size-3" />
        Paiement échoué
      </span>
    );
  }
  if (status === "refunded") {
    return (
      <span className="text-muted inline-flex items-center gap-1 text-[11px] font-medium">
        <CreditCard className="size-3" />
        Remboursé
      </span>
    );
  }
  // pending
  return (
    <span
      className={cn(
        "inline-flex items-center gap-1 text-[11px] font-semibold",
        "text-warning-700"
      )}
    >
      <Hourglass className="size-3" />
      Paiement en attente
    </span>
  );
}
