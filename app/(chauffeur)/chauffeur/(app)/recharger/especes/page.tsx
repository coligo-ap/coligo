import { Suspense } from "react";
import { redirect } from "next/navigation";
import { PayCashTopup } from "@/components/wallet/pay/pay-cash-topup";
import { getFeatureFlags } from "@/lib/data/feature-flags";

/** Recharge en espèces — annuaire des agents Coligo Pay (liste / carte). */
export default async function ChauffeurRechargeEspecesPage() {
  // Réseau d'agents masqué (coligo_pay_agents, mig 0449) → retour aux méthodes.
  const flags = await getFeatureFlags();
  if (flags.coligo_pay_agents.status !== "active")
    redirect("/chauffeur/recharger/methode");
  return (
    <div className="drive-jakarta drive-page pt-safe pb-safe-nav min-h-screen bg-[var(--d-surface)] px-5">
      <Suspense fallback={null}>
        <PayCashTopup base="/chauffeur" />
      </Suspense>
    </div>
  );
}
