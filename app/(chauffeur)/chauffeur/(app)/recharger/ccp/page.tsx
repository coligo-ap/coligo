import { Suspense } from "react";
import { PayCcpTopup } from "@/components/wallet/pay/pay-ccp-topup";

/** Recharge par virement CCP — étapes, coordonnées, preuve, envoi. */
export default function ChauffeurRechargeCcpPage() {
  return (
    <div className="drive-jakarta drive-page pt-safe pb-safe-nav min-h-screen bg-[var(--d-surface)] px-5">
      <Suspense fallback={null}>
        <PayCcpTopup base="/chauffeur" />
      </Suspense>
    </div>
  );
}
