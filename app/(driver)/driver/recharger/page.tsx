import { redirect } from "next/navigation";
import { getCurrentDriver } from "@/lib/auth/driver";
import { DriverShell } from "@/components/driver/driver-shell";
import { RechargePoints } from "@/components/wallet/recharge-points";

export const dynamic = "force-dynamic";

export default async function DriverRechargerPage() {
  const driver = await getCurrentDriver();
  if (!driver) redirect("/driver/login");
  return (
    <DriverShell driverFirstName={driver.full_name.split(" ")[0]}>
      <div className="p-4">
        <RechargePoints />
      </div>
    </DriverShell>
  );
}
