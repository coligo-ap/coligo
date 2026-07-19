import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentDriver } from "@/lib/auth/driver";
import { requireActiveDriver } from "@/lib/auth/driver-gate";
import { DriverShell } from "@/components/driver/driver-shell";
import { PayMethodChoice } from "@/components/wallet/pay/pay-method-choice";

export const dynamic = "force-dynamic";

/** Recharger — étape 1 : choisir sa méthode (Carte / CCP / Espèces). */
export default async function DriverRechargeMethodePage() {
  await requireActiveDriver();
  const driver = await getCurrentDriver();
  if (!driver) redirect("/driver/login");
  return (
    <DriverShell driverFirstName={driver.full_name.split(" ")[0]}>
      <Suspense fallback={null}>
        <PayMethodChoice base="/driver" />
      </Suspense>
    </DriverShell>
  );
}
