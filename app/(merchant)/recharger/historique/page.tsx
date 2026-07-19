import { Suspense } from "react";
import { PayHistory } from "@/components/wallet/pay/pay-history";
import { PaySkeleton } from "@/components/wallet/pay/pay-core";

/** Historique Coligo Pay — filtres type/période, liste complète. */
export default function MerchantPayHistoriquePage() {
  return (
    <div className="mx-auto max-w-[1100px] p-4 lg:p-6 lg:px-8">
      <Suspense fallback={<PaySkeleton hero={false} />}>
        <PayHistory base="" />
      </Suspense>
    </div>
  );
}
