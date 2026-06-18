import Link from "next/link";
import { redirect } from "next/navigation";
import { getTranslations } from "next-intl/server";
import { ArrowLeft } from "lucide-react";
import { CustomerShell } from "@/components/customer/customer-shell";
import { createClient } from "@/lib/supabase/server";
import { getCurrentCustomer } from "@/lib/auth/customer";
import { AddressesPanel } from "@/components/customer/addresses-panel";

export const dynamic = "force-dynamic";

export default async function AddressesPage() {
  const t = await getTranslations("account");
  // Session mémoïsée (partagée avec CustomerShell → pas de double auth).
  const customer = await getCurrentCustomer();
  if (!customer) redirect("/se-connecter");

  const supabase = await createClient();
  const { data: addresses } = await supabase
    .from("customer_addresses")
    .select("id, label, lat, lng, address_text, phone_override, is_default")
    .eq("customer_id", customer.id)
    .order("is_default", { ascending: false })
    .order("created_at", { ascending: false });

  return (
    <CustomerShell>
      <div className="mx-auto max-w-2xl p-4 pb-24 lg:p-6">
        <Link
          href="/compte"
          className="text-muted hover:text-foreground mb-3 inline-flex items-center gap-1.5 text-sm font-medium"
        >
          <ArrowLeft className="size-4 rtl:-scale-x-100" />
          {t("myAccount")}
        </Link>
        <header className="mb-5">
          <h1 className="text-2xl font-bold tracking-tight">
            {t("myAddresses")}
          </h1>
          <p className="text-muted mt-1 text-sm">{t("addressesSubtitle")}</p>
        </header>
        <AddressesPanel addresses={addresses ?? []} />
      </div>
    </CustomerShell>
  );
}
