import { redirect } from "next/navigation";
import { getCurrentDriver } from "@/lib/auth/driver";
import { DriverShell } from "@/components/driver/driver-shell";
import { GainsLoader } from "@/components/driver/gains/gains-loader";
import { MoneyTabs } from "@/components/shared/money-tabs";

export const dynamic = "force-dynamic";

export default async function DriverGainsPage() {
  // Page mince : on garde la barrière d'auth côté serveur (sécurité), mais on
  // ne charge PLUS les gains ici. La donnée est lue côté client via TanStack
  // Query (GainsLoader) → cache partagé entre navigations, réaffichage instantané
  // au retour, refetch silencieux. Voir CLAUDE.md « Performance & navigation ».
  const driver = await getCurrentDriver();
  if (!driver) redirect("/driver/login");

  return (
    <DriverShell driverFirstName={driver.full_name.split(" ")[0]}>
      {/* Hub Argent : Gains · Courses · Coligo Pay dans une même page. */}
      <MoneyTabs base="/driver" />
      <GainsLoader driverId={driver.id} />
    </DriverShell>
  );
}
