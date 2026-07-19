import { Suspense } from "react";
import { PayWithdraw } from "@/components/wallet/pay/pay-withdraw";

/** Retirer mon argent Coligo Pay — demande CCP / BaridiMob (mig 0384). */
export default function ChauffeurPayRetirerPage() {
  return (
    <div className="drive-jakarta drive-page pt-safe pb-safe-nav min-h-screen bg-[var(--d-surface)] px-5">
      <Suspense fallback={null}>
        <PayWithdraw base="/chauffeur" />
      </Suspense>
    </div>
  );
}
