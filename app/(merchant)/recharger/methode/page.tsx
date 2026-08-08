import { Suspense } from "react";
import { PayMethodChoice } from "@/components/wallet/pay/pay-method-choice";
import { PaySkeleton } from "@/components/wallet/pay/pay-core";
import { getFeatureFlags } from "@/lib/data/feature-flags";

/** Recharger — étape 1 : choisir sa méthode (Carte / CCP / Espèces). */
export default async function MerchantRechargeMethodePage() {
  const flags = await getFeatureFlags();
  return (
    <div className="mx-auto max-w-[1100px] p-4 lg:p-6 lg:px-8">
      <Suspense fallback={<PaySkeleton hero={false} />}>
        <PayMethodChoice
          base=""
          agentsEnabled={flags.coligo_pay_agents.status === "active"}
        />
      </Suspense>
    </div>
  );
}
