import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentDriver } from "@/lib/auth/driver";
import { DriverShell } from "@/components/driver/driver-shell";
import { OperatorRecharge } from "@/components/wallet/operator-recharge";
import { MoneyTabs } from "@/components/shared/money-tabs";

export const dynamic = "force-dynamic";

export default async function DriverRechargerPage() {
  const driver = await getCurrentDriver();
  if (!driver) redirect("/driver/login");
  return (
    <DriverShell driverFirstName={driver.full_name.split(" ")[0]}>
      {/* Hub Argent : Gains · Courses · Coligo Pay dans une même page. */}
      <MoneyTabs base="/driver" />
      <Suspense fallback={null}>
        <OperatorRecharge inHub />
      </Suspense>
    </DriverShell>
  );
}
