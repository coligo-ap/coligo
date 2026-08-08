import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentDriver } from "@/lib/auth/driver";
import { requireActiveDriver } from "@/lib/auth/driver-gate";
import { DriverShell } from "@/components/driver/driver-shell";
import { PayMethodChoice } from "@/components/wallet/pay/pay-method-choice";
import { getFeatureFlags } from "@/lib/data/feature-flags";

export const dynamic = "force-dynamic";

/** Recharger — étape 1 : choisir sa méthode (Carte / CCP / Espèces). */
export default async function DriverRechargeMethodePage() {
  await requireActiveDriver();
  const [driver, flags] = await Promise.all([
    getCurrentDriver(),
    getFeatureFlags(),
  ]);
  if (!driver) redirect("/driver/login");
  return (
    <DriverShell driverFirstName={driver.full_name.split(" ")[0]}>
      <Suspense fallback={null}>
        <PayMethodChoice
          base="/driver"
          agentsEnabled={flags.coligo_pay_agents.status === "active"}
        />
      </Suspense>
    </DriverShell>
  );
}
