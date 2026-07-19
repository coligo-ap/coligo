import { Suspense } from "react";
import { PaySettings } from "@/components/wallet/pay/pay-settings";
import { PaySkeleton } from "@/components/wallet/pay/pay-core";

/** Paramètres financiers Coligo Pay (commerçant). */
export default function MerchantPayParametresPage() {
  return (
    <div className="mx-auto max-w-[1100px] p-4 lg:p-6 lg:px-8">
      <Suspense fallback={<PaySkeleton hero={false} />}>
        <PaySettings base="" />
      </Suspense>
    </div>
  );
}
