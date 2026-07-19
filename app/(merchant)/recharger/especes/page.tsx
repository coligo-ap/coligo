import { Suspense } from "react";
import { PayCashTopup } from "@/components/wallet/pay/pay-cash-topup";
import { PaySkeleton } from "@/components/wallet/pay/pay-core";

/** Recharge en espèces — annuaire des agents Coligo Pay (liste / carte). */
export default function MerchantRechargeEspecesPage() {
  return (
    <div className="mx-auto max-w-[1100px] p-4 lg:p-6 lg:px-8">
      <Suspense fallback={<PaySkeleton hero={false} />}>
        <PayCashTopup base="" />
      </Suspense>
    </div>
  );
}
