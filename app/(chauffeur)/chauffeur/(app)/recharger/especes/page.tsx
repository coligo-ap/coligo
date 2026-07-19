import { Suspense } from "react";
import { PayCashTopup } from "@/components/wallet/pay/pay-cash-topup";

/** Recharge en espèces — annuaire des agents Coligo Pay (liste / carte). */
export default function ChauffeurRechargeEspecesPage() {
  return (
    <div className="drive-jakarta drive-page pt-safe pb-safe-nav min-h-screen bg-[var(--d-surface)] px-5">
      <Suspense fallback={null}>
        <PayCashTopup base="/chauffeur" />
      </Suspense>
    </div>
  );
}
