import { redirect } from "next/navigation";
import { CustomerShell } from "@/components/customer/customer-shell";
import { CheckoutView } from "@/components/customer/checkout-view";
import { getFeatureFlag } from "@/lib/data/feature-flags";
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

  // `getFeatureFlag` (singulier) = kill-switch global PUIS coupure propre au
  // compte (mig 0397) → le checkout dit la vérité à ce client-là.
  const [customer, online, pay, cashback] = await Promise.all([
    getCurrentCustomerFull(),
    getFeatureFlag("online_payment"),
    getFeatureFlag("coligo_pay"),
    getFeatureFlag("cashback"),
  ]);

  return (
    <CustomerShell>
      {/* Fond BLANC pur (style Bolt Food) sur tout le checkout. */}
      <div className="min-h-screen bg-white">
        <CheckoutView
          customer={{
            full_name: customer?.full_name ?? "",
            phone: customer?.phone ?? "",
            latitude: customer?.latitude ?? null,
            longitude: customer?.longitude ?? null,
          }}
          onlinePaymentStatus={online.status}
          onlinePaymentPersonal={online.personal}
          coligoPayStatus={pay.status}
          cashbackStatus={cashback.status}
        />
      </div>
    </CustomerShell>
  );
}
