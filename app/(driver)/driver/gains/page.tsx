import { redirect } from "next/navigation";
import { getCurrentDriver } from "@/lib/auth/driver";
import { createClient } from "@/lib/supabase/server";
import { DriverShell } from "@/components/driver/driver-shell";
import { GainsView } from "@/components/driver/gains/gains-view";

export const dynamic = "force-dynamic";

export default async function DriverGainsPage() {
  const supabase = await createClient();
  const driver = await getCurrentDriver();
  if (!driver) redirect("/driver/login");

  // Même requête que la version précédente — calculs métier inchangés.
  const { data: rows } = await supabase
    .from("delivery_ledger")
    .select("id, type, amount_da, note, created_at, merchant_id")
    .eq("driver_id", driver.id)
    .order("created_at", { ascending: false })
    .limit(200);

  return (
    <DriverShell driverFirstName={driver.full_name.split(" ")[0]}>
      <GainsView entries={rows ?? []} />
    </DriverShell>
  );
}
