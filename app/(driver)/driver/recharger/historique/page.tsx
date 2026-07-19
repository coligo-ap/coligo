import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentDriver } from "@/lib/auth/driver";
import { requireActiveDriver } from "@/lib/auth/driver-gate";
import { DriverShell } from "@/components/driver/driver-shell";
import { PayHistory } from "@/components/wallet/pay/pay-history";

export const dynamic = "force-dynamic";

/** Historique Coligo Pay — filtres type/période, liste complète. */
export default async function DriverPayHistoriquePage() {
  await requireActiveDriver();
  const driver = await getCurrentDriver();
  if (!driver) redirect("/driver/login");
  return (
    <DriverShell driverFirstName={driver.full_name.split(" ")[0]}>
      <Suspense fallback={null}>
        <PayHistory base="/driver" />
      </Suspense>
    </DriverShell>
  );
}
