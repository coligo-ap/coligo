import { redirect } from "next/navigation";
import { getCurrentPartner } from "@/lib/auth/partner";
import { PartnerSubPage } from "@/components/partner/partner-subpage";

import { OperatorRecharge } from "@/components/wallet/operator-recharge";

export const dynamic = "force-dynamic";
export const metadata = { title: "Recharger mon crédit — Coligo Pay" };

/**
 * Recharge du solde de l'AGENT (carte Chargily ou virement/CCP avec preuve).
 * Le module vit ici en PLEIN écran : sur l'accueil il était rendu en mode
 * « compact » au milieu du reste, ce qui écrasait ses propres étapes.
 */
export default async function PartnerTopupPage() {
  const partner = await getCurrentPartner();
  if (!partner) redirect("/partenaire/login");
  if (partner.status !== "active") redirect("/partenaire");
  return (
    <PartnerSubPage
      title="Recharger mon crédit"
      subtitle="Par carte ou par virement / CCP"
    >
      <OperatorRecharge compact />
    </PartnerSubPage>
  );
}
