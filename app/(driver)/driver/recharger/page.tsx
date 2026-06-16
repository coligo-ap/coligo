import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentDriver } from "@/lib/auth/driver";
import { DriverShell } from "@/components/driver/driver-shell";
import { OperatorRecharge } from "@/components/wallet/operator-recharge";
import { RechargePoints } from "@/components/wallet/recharge-points";

export const dynamic = "force-dynamic";

export default async function DriverRechargerPage() {
  const driver = await getCurrentDriver();
  if (!driver) redirect("/driver/login");
  return (
    <DriverShell driverFirstName={driver.full_name.split(" ")[0]}>
      <div className="p-4">
        <Suspense fallback={null}>
          <OperatorRecharge />
        </Suspense>
        <RechargePoints />
      </div>
    </DriverShell>
  );
}
