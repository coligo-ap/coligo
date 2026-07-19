import { Suspense } from "react";
import { PaySettings } from "@/components/wallet/pay/pay-settings";

/** Paramètres financiers Coligo Pay (chauffeur). */
export default function ChauffeurPayParametresPage() {
  return (
    <div className="drive-jakarta drive-page pt-safe pb-safe-nav min-h-screen bg-[var(--d-surface)] px-5">
      <Suspense fallback={null}>
        <PaySettings base="/chauffeur" />
      </Suspense>
    </div>
  );
}
