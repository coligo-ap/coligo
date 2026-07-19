import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentDriver } from "@/lib/auth/driver";
import { requireActiveDriver } from "@/lib/auth/driver-gate";
import { DriverShell } from "@/components/driver/driver-shell";
import { PayCcpTopup } from "@/components/wallet/pay/pay-ccp-topup";

export const dynamic = "force-dynamic";

/** Recharge par virement CCP — étapes, coordonnées, preuve, envoi. */
export default async function DriverRechargeCcpPage() {
  await requireActiveDriver();
  const driver = await getCurrentDriver();
  if (!driver) redirect("/driver/login");
  return (
    <DriverShell driverFirstName={driver.full_name.split(" ")[0]}>
      <Suspense fallback={null}>
        <PayCcpTopup base="/driver" />
      </Suspense>
    </DriverShell>
  );
}
