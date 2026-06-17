import { redirect } from "next/navigation";
import { getCurrentPartner } from "@/lib/auth/partner";
import { PartnerDashboard } from "@/components/partner/partner-dashboard";

export const dynamic = "force-dynamic";

export default async function PartnerHomePage() {
  const partner = await getCurrentPartner();
  if (!partner) redirect("/partenaire/login");
  return (
    <PartnerDashboard
      walletId={partner.walletId}
      displayName={partner.displayName}
      status={partner.status}
      isVerified={partner.isVerified}
      rejectedReason={partner.rejectedReason}
      address={partner.address}
      phone={partner.phone}
    />
  );
}
