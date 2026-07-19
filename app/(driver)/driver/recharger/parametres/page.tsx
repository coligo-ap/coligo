import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentDriver } from "@/lib/auth/driver";
import { requireActiveDriver } from "@/lib/auth/driver-gate";
import { DriverShell } from "@/components/driver/driver-shell";
import { PaySettings } from "@/components/wallet/pay/pay-settings";

export const dynamic = "force-dynamic";

/** Paramètres financiers Coligo Pay (livreur). */
export default async function DriverPayParametresPage() {
  await requireActiveDriver();
  const driver = await getCurrentDriver();
  if (!driver) redirect("/driver/login");
  return (
    <DriverShell driverFirstName={driver.full_name.split(" ")[0]}>
      <Suspense fallback={null}>
        <PaySettings base="/driver" />
      </Suspense>
    </DriverShell>
  );
}
