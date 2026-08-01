import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { getCurrentPartner } from "@/lib/auth/partner";
import { getFeatureFlags } from "@/lib/data/feature-flags";
import { PartnerHub } from "@/components/partner/partner-hub";
import { FeatureBlockedBanner } from "@/components/shared/feature-blocked-banner";

export const dynamic = "force-dynamic";

export default async function PartnerHomePage() {
  const partner = await getCurrentPartner();
  if (!partner) redirect("/partenaire/login");
  const [flags, locale] = await Promise.all([getFeatureFlags(), getLocale()]);
  return (
    <>
      {/* Coligo Pay suspendu par l'équipe Coligo → l'agent le sait AVANT que
          ses ventes échouent (le backend refuse déjà : triggers mig 0182). */}
      {flags.coligo_pay.status !== "active" && (
        <div className="mx-auto max-w-2xl px-4 pt-4">
          <FeatureBlockedBanner
            flag={flags.coligo_pay}
            locale={locale}
            fallbackMessage={
              locale === "ar"
                ? "علّق فريق كوليغو خدمة كوليغو باي مؤقتًا — بيع التعبئة متوقف حتى إشعار آخر."
                : "L'équipe Coligo a suspendu temporairement Coligo Pay — la vente de recharges est bloquée jusqu'à nouvel ordre."
            }
          />
        </div>
      )}
      <PartnerHub
        walletId={partner.walletId}
        displayName={partner.displayName}
        status={partner.status}
        isVerified={partner.isVerified}
        rejectedReason={partner.rejectedReason}
        address={partner.address}
        phone={partner.phone}
      />
    </>
  );
}
