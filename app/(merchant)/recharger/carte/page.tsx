import { Suspense } from "react";
import { PayCardTopup } from "@/components/wallet/pay/pay-card-topup";
import { PaySkeleton } from "@/components/wallet/pay/pay-core";

/** Recharge par carte (Chargily) — montant → paiement → écran de résultat. */
export default function MerchantRechargeCartePage() {
  return (
    <div className="mx-auto max-w-[1100px] p-4 lg:p-6 lg:px-8">
      {/* Suspense requis : PayCardTopup lit `?topup=` (retour Chargily). */}
      <Suspense fallback={<PaySkeleton hero={false} />}>
        <PayCardTopup base="" />
      </Suspense>
    </div>
  );
}
