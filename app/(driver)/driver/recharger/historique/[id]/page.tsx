import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getCurrentDriver } from "@/lib/auth/driver";
import { requireActiveDriver } from "@/lib/auth/driver-gate";
import { DriverShell } from "@/components/driver/driver-shell";
import { PayEntryDetail } from "@/components/wallet/pay/pay-entry-detail";

export const dynamic = "force-dynamic";

/** Détail d'une opération Coligo Pay — reçu financier. */
export default async function DriverPayEntryPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  await requireActiveDriver();
  const driver = await getCurrentDriver();
  if (!driver) redirect("/driver/login");
  const { id } = await params;
  return (
    <DriverShell driverFirstName={driver.full_name.split(" ")[0]}>
      <Suspense fallback={null}>
        <PayEntryDetail base="/driver" id={id} />
      </Suspense>
    </DriverShell>
  );
}
