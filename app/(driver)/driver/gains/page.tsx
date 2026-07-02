import { redirect } from "next/navigation";
import { getCurrentDriver } from "@/lib/auth/driver";
import { getDriverSettlement } from "@/lib/driver/settlement-data";
import { DriverShell } from "@/components/driver/driver-shell";
import { GainsLoader } from "@/components/driver/gains/gains-loader";
import { MoneyTabs } from "@/components/shared/money-tabs";
import {
  SettlementVerdict,
  WalletGlance,
} from "@/components/partner/money-overview";

export const dynamic = "force-dynamic";

export default async function DriverGainsPage() {
  // Page mince : on garde la barrière d'auth côté serveur (sécurité), mais on
  // ne charge PLUS les gains ici. La donnée est lue côté client via TanStack
  // Query (GainsLoader) → cache partagé entre navigations, réaffichage instantané
  // au retour, refetch silencieux. Voir CLAUDE.md « Performance & navigation ».
  const driver = await getCurrentDriver();
  if (!driver) redirect("/driver/login");

  // Verdict « où j'en suis avec Coligo » (montant réel, période en cours).
  const settlement = await getDriverSettlement(driver.id);

  return (
    <DriverShell driverFirstName={driver.full_name.split(" ")[0]}>
      {/* Hub Argent : Gains · Courses · Coligo Pay dans une même page.
          Ordre HUMAIN : 1. ce que j'ai gagné → 2. où j'en suis avec Coligo
          (montant réel + Détail + PDF) → 3. mon solde Coligo Pay. */}
      <MoneyTabs base="/driver" />
      <GainsLoader driverId={driver.id} />
      <SettlementVerdict
        direction={settlement.direction}
        amountDa={settlement.netDa}
        dueLabel={settlement.dueLabel}
        detailHref="/driver/releve"
        pdfHref="/api/pdf/releve"
      />
      <WalletGlance rechargeHref="/driver/recharger" />
    </DriverShell>
  );
}
