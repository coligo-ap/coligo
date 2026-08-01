import { redirect } from "next/navigation";
import { getCurrentPartner } from "@/lib/auth/partner";
import { PartnerSubPage } from "@/components/partner/partner-subpage";

import { PartnerHistoryScreen } from "@/components/partner/partner-history-screen";

export const dynamic = "force-dynamic";
export const metadata = { title: "Historique — Coligo Pay" };

export default async function PartnerHistoryPage() {
  const partner = await getCurrentPartner();
  if (!partner) redirect("/partenaire/login");
  return (
    <PartnerSubPage title="Historique" subtitle="Ventes, recharges et bonus">
      <PartnerHistoryScreen />
    </PartnerSubPage>
  );
}
