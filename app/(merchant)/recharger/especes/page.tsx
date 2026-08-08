import { Suspense } from "react";
import { redirect } from "next/navigation";
import { PayCashTopup } from "@/components/wallet/pay/pay-cash-topup";
import { PaySkeleton } from "@/components/wallet/pay/pay-core";
import { getFeatureFlags } from "@/lib/data/feature-flags";

/** Recharge en espèces — annuaire des agents Coligo Pay (liste / carte). */
export default async function MerchantRechargeEspecesPage() {
  // Réseau d'agents masqué (coligo_pay_agents, mig 0449) → retour aux méthodes.
  const flags = await getFeatureFlags();
  if (flags.coligo_pay_agents.status !== "active")
    redirect("/recharger/methode");
  return (
    <div className="mx-auto max-w-[1100px] p-4 lg:p-6 lg:px-8">
      <Suspense fallback={<PaySkeleton hero={false} />}>
        <PayCashTopup base="" />
      </Suspense>
    </div>
  );
}
