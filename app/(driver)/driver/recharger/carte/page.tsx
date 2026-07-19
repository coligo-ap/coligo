import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentDriver } from "@/lib/auth/driver";
import { requireActiveDriver } from "@/lib/auth/driver-gate";
import { DriverShell } from "@/components/driver/driver-shell";
import { PayCardTopup } from "@/components/wallet/pay/pay-card-topup";

export const dynamic = "force-dynamic";

/** Recharge par carte (Chargily) — montant → paiement → écran de résultat. */
export default async function DriverRechargeCartePage() {
  await requireActiveDriver();
  const driver = await getCurrentDriver();
  if (!driver) redirect("/driver/login");
  return (
    <DriverShell driverFirstName={driver.full_name.split(" ")[0]}>
      {/* Suspense requis : PayCardTopup lit `?topup=` (retour Chargily). */}
      <Suspense fallback={null}>
        <PayCardTopup base="/driver" />
      </Suspense>
    </DriverShell>
  );
}
