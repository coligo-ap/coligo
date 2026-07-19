import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentDriver } from "@/lib/auth/driver";
import { requireActiveDriver } from "@/lib/auth/driver-gate";
import { DriverShell } from "@/components/driver/driver-shell";
import { PayCashTopup } from "@/components/wallet/pay/pay-cash-topup";

export const dynamic = "force-dynamic";

/** Recharge en espèces — annuaire des agents Coligo Pay (liste / carte). */
export default async function DriverRechargeEspecesPage() {
  await requireActiveDriver();
  const driver = await getCurrentDriver();
  if (!driver) redirect("/driver/login");
  return (
    <DriverShell driverFirstName={driver.full_name.split(" ")[0]}>
      <Suspense fallback={null}>
        <PayCashTopup base="/driver" />
      </Suspense>
    </DriverShell>
  );
}
