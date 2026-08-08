import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentDriver } from "@/lib/auth/driver";
import { requireActiveDriver } from "@/lib/auth/driver-gate";
import { DriverShell } from "@/components/driver/driver-shell";
import { PayCashTopup } from "@/components/wallet/pay/pay-cash-topup";
import { getFeatureFlags } from "@/lib/data/feature-flags";

export const dynamic = "force-dynamic";

/** Recharge en espèces — annuaire des agents Coligo Pay (liste / carte). */
export default async function DriverRechargeEspecesPage() {
  await requireActiveDriver();
  const [driver, flags] = await Promise.all([
    getCurrentDriver(),
    getFeatureFlags(),
  ]);
  if (!driver) redirect("/driver/login");
  // Réseau d'agents masqué (coligo_pay_agents, mig 0449) → retour aux méthodes.
  if (flags.coligo_pay_agents.status !== "active")
    redirect("/driver/recharger/methode");
  return (
    <DriverShell driverFirstName={driver.full_name.split(" ")[0]}>
      <Suspense fallback={null}>
        <PayCashTopup base="/driver" />
      </Suspense>
    </DriverShell>
  );
}
