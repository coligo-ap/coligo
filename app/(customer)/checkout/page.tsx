import { redirect } from "next/navigation";
import { CustomerShell } from "@/components/customer/customer-shell";
import { CheckoutView } from "@/components/customer/checkout-view";
import { getFeatureFlags } from "@/lib/data/feature-flags";
import { getAuthUser } from "@/lib/auth/session";
import { getCurrentMerchant } from "@/lib/auth/merchant";
import { getCurrentCustomerFull } from "@/lib/auth/customer";

export const dynamic = "force-dynamic";

export default async function CheckoutPage() {
  // Auth obligatoire au checkout (PARTIE A). Session + profil mémoïsés
  // (partagés avec CustomerShell → pas de double auth ni requête redondante).
  if (!(await getAuthUser())) redirect("/se-connecter?next=/checkout");
  // Si l'utilisateur connecté est un MARCHAND, pas un client → on l'arrête.
  if (await getCurrentMerchant()) redirect("/dashboard");

  const [customer, flags] = await Promise.all([
    getCurrentCustomerFull(),
    getFeatureFlags(),
  ]);

  return (
    <CustomerShell>
      <CheckoutView
        customer={{
          full_name: customer?.full_name ?? "",
          phone: customer?.phone ?? "",
          latitude: customer?.latitude ?? null,
          longitude: customer?.longitude ?? null,
        }}
        onlinePaymentStatus={flags.online_payment.status}
        coligoPayStatus={flags.coligo_pay.status}
        cashbackStatus={flags.cashback.status}
      />
    </CustomerShell>
  );
}
