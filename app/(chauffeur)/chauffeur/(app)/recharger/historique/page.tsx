import { Suspense } from "react";
import { PayHistory } from "@/components/wallet/pay/pay-history";

/** Historique Coligo Pay — filtres type/période, liste complète. */
export default function ChauffeurPayHistoriquePage() {
  return (
    <div className="drive-jakarta drive-page pt-safe pb-safe-nav min-h-screen bg-[var(--d-surface)] px-5">
      <Suspense fallback={null}>
        <PayHistory base="/chauffeur" />
      </Suspense>
    </div>
  );
}
