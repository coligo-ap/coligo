import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { CustomerShell } from "@/components/customer/customer-shell";
import { getCurrentCustomer } from "@/lib/auth/customer";
import { OrdersLoader } from "@/components/customer/orders-loader";

export const dynamic = "force-dynamic";

export default async function CustomerOrdersListPage() {
  const t = await getTranslations("orders");
  // Session mémoïsée (partagée avec CustomerShell → pas de double auth).
  const customer = await getCurrentCustomer();
  if (!customer) redirect("/se-connecter?next=/commandes");

  // La page ne fait plus de fetch bloquant : la liste est chargée par TanStack
  // Query (OrdersLoader) → cache persistant entre navigations, refetch en fond.
  return (
    <CustomerShell>
      <div className="mx-auto max-w-3xl px-4 py-4 lg:px-6 lg:py-8">
        <header className="mb-5">
          <h1 className="text-foreground text-2xl font-bold lg:text-3xl">
            {t("myOrders")}
          </h1>
          <p className="text-muted text-sm">{t("listSubtitle")}</p>
        </header>
        <OrdersLoader customerId={customer.id} />
      </div>
    </CustomerShell>
  );
}
