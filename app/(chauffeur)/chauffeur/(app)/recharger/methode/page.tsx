import { Suspense } from "react";
import { PayMethodChoice } from "@/components/wallet/pay/pay-method-choice";
import { getFeatureFlags } from "@/lib/data/feature-flags";

/** Recharger — étape 1 : choisir sa méthode (Carte / CCP / Espèces). */
export default async function ChauffeurRechargeMethodePage() {
  const flags = await getFeatureFlags();
  return (
    <div className="drive-jakarta drive-page pt-safe pb-safe-nav min-h-screen bg-[var(--d-surface)] px-5">
      <Suspense fallback={null}>
        <PayMethodChoice
          base="/chauffeur"
          agentsEnabled={flags.coligo_pay_agents.status === "active"}
        />
      </Suspense>
    </div>
  );
}
