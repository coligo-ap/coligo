import { Suspense } from "react";
import { PayMethodChoice } from "@/components/wallet/pay/pay-method-choice";

/** Recharger — étape 1 : choisir sa méthode (Carte / CCP / Espèces). */
export default function ChauffeurRechargeMethodePage() {
  return (
    <div className="drive-jakarta drive-page pt-safe pb-safe-nav min-h-screen bg-[var(--d-surface)] px-5">
      <Suspense fallback={null}>
        <PayMethodChoice base="/chauffeur" />
      </Suspense>
    </div>
  );
}
