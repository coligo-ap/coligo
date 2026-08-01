import { redirect } from "next/navigation";
import { getCurrentPartner } from "@/lib/auth/partner";
import { PartnerSubPage } from "@/components/partner/partner-subpage";

import { PartnerHelpScreen } from "@/components/partner/partner-help-screen";

export const dynamic = "force-dynamic";
export const metadata = { title: "Comment ça marche — Coligo Pay" };

export default async function PartnerHelpPage() {
  const partner = await getCurrentPartner();
  if (!partner) redirect("/partenaire/login");
  return (
    <PartnerSubPage
      title="Comment ça marche"
      subtitle="Le métier d'agent en 3 étapes"
    >
      <PartnerHelpScreen />
    </PartnerSubPage>
  );
}
