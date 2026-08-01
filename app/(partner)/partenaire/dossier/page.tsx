import { redirect } from "next/navigation";
import { getCurrentPartner } from "@/lib/auth/partner";
import { PartnerSubPage } from "@/components/partner/partner-subpage";

import { DossierSection } from "@/components/partner/dossier-section";

export const dynamic = "force-dynamic";
export const metadata = { title: "Mon dossier — Coligo Pay" };

/**
 * Pièces justificatives de l'agent. Sur le hub, le dossier n'apparaît que tant
 * que le compte n'est PAS actif (c'est alors la seule chose à faire) ; une fois
 * actif, il vit ici — consultable et remplaçable sans encombrer l'accueil.
 */
export default async function PartnerDossierPage() {
  const partner = await getCurrentPartner();
  if (!partner) redirect("/partenaire/login");
  return (
    <PartnerSubPage title="Mon dossier" subtitle="Pièces justificatives">
      <DossierSection walletId={partner.walletId} />
    </PartnerSubPage>
  );
}
