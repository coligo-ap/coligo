import { Suspense } from "react";
import { PayCcpTopup } from "@/components/wallet/pay/pay-ccp-topup";
import { PaySkeleton } from "@/components/wallet/pay/pay-core";

/** Recharge par virement CCP — étapes, coordonnées, preuve, envoi. */
export default function MerchantRechargeCcpPage() {
  return (
    <div className="mx-auto max-w-[1100px] p-4 lg:p-6 lg:px-8">
      <Suspense fallback={<PaySkeleton hero={false} />}>
        <PayCcpTopup base="" />
      </Suspense>
    </div>
  );
}
