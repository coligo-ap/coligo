import { Suspense } from "react";
import { PayMethodChoice } from "@/components/wallet/pay/pay-method-choice";
import { PaySkeleton } from "@/components/wallet/pay/pay-core";

/** Recharger — étape 1 : choisir sa méthode (Carte / CCP / Espèces). */
export default function MerchantRechargeMethodePage() {
  return (
    <div className="mx-auto max-w-[1100px] p-4 lg:p-6 lg:px-8">
      <Suspense fallback={<PaySkeleton hero={false} />}>
        <PayMethodChoice base="" />
      </Suspense>
    </div>
  );
}
