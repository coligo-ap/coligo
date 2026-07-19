import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentDriver } from "@/lib/auth/driver";
import { requireActiveDriver } from "@/lib/auth/driver-gate";
import { DriverShell } from "@/components/driver/driver-shell";
import { PayWithdraw } from "@/components/wallet/pay/pay-withdraw";

export const dynamic = "force-dynamic";

/** Retirer mon argent Coligo Pay — demande CCP / BaridiMob (mig 0384). */
export default async function DriverPayRetirerPage() {
  await requireActiveDriver();
  const driver = await getCurrentDriver();
  if (!driver) redirect("/driver/login");
  return (
    <DriverShell driverFirstName={driver.full_name.split(" ")[0]}>
      <Suspense fallback={null}>
        <PayWithdraw base="/driver" />
      </Suspense>
    </DriverShell>
  );
}
