import { Suspense } from "react";
import { DBack } from "@/components/chauffeur/d-ui";
import { OperatorRecharge } from "@/components/wallet/operator-recharge";

/**
 * Recharge portefeuille opérateur. L'auth est garantie par la coque `(app)`
 * (ChauffeurGateGuard) → pas d'`await` ici, rendu instantané.
 */
export default function ChauffeurRechargerPage() {
  return (
    <div className="drive-jakarta drive-page min-h-screen bg-[var(--d-page)] px-5 pt-4 pb-24">
      <div className="mb-1 flex items-center gap-2">
        <DBack />
      </div>
      <Suspense fallback={null}>
        <OperatorRecharge />
      </Suspense>
    </div>
  );
}
