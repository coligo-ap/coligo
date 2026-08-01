import { redirect } from "next/navigation";
import { getCurrentPartner } from "@/lib/auth/partner";
import { PartnerSubPage } from "@/components/partner/partner-subpage";

import { PartnerSellScreen } from "@/components/partner/partner-sell-screen";

export const dynamic = "force-dynamic";
export const metadata = { title: "Vendre du crédit — Coligo Pay" };

/**
 * Le geste métier de l'agent, sur SA page : trouver le bénéficiaire, saisir le
 * montant reçu en espèces, confirmer au PIN. Rien d'autre à l'écran.
 */
export default async function PartnerSellPage() {
  const partner = await getCurrentPartner();
  if (!partner) redirect("/partenaire/login");
  // Un compte non actif ne vend pas : on le renvoie au hub, qui explique
  // exactement où en est son dossier.
  if (partner.status !== "active") redirect("/partenaire");
  return (
    <PartnerSubPage
      title="Vendre du crédit"
      subtitle="Le client paie en espèces, vous envoyez le crédit"
    >
      <PartnerSellScreen />
    </PartnerSubPage>
  );
}
