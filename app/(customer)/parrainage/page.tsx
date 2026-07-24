import { redirect } from "next/navigation";
import Link from "next/link";
import { getTranslations } from "next-intl/server";
import { ArrowLeft, Gift } from "lucide-react";
import { CustomerShell } from "@/components/customer/customer-shell";
import { getAuthUser } from "@/lib/auth/session";
import { getCurrentMerchant } from "@/lib/auth/merchant";
import { getFeatureFlag } from "@/lib/data/feature-flags";
import { getMyReferralOverview } from "@/lib/referral/overview";
import { ReferralView } from "@/components/customer/referral/referral-view";

export const dynamic = "force-dynamic";

// =============================================================================
// « Parrainage » — le client partage son code (WhatsApp), suit ses filleuls et
// ses gains. Récompenses créditées sur Coligo Pay (mig 0403).
// =============================================================================
export default async function ReferralPage() {
  const t = await getTranslations("referral");
  const user = await getAuthUser();
  if (!user) redirect("/se-connecter?next=/parrainage");

  const [merchant, flag] = await Promise.all([
    getCurrentMerchant(),
    getFeatureFlag("referral"),
  ]);
  if (merchant) redirect("/dashboard");
  // Masqué par le super-admin → la page n'existe pas pour le client.
  if (flag.status === "hidden") redirect("/compte");

  const overview = await getMyReferralOverview();

  return (
    <CustomerShell>
      <div className="mx-auto max-w-2xl px-4 py-4 pb-24 lg:px-6 lg:py-8">
        <Link
          href="/compte"
          className="text-muted hover:text-foreground mb-3 inline-flex items-center gap-1.5 text-sm"
        >
          <ArrowLeft className="size-4 rtl:-scale-x-100" />
          {t("back")}
        </Link>

        <h1 className="text-foreground mb-1 flex items-center gap-2 text-2xl font-extrabold tracking-tight">
          <Gift className="text-primary-600 size-6" />
          {t("title")}
        </h1>
        <p className="text-muted mb-5 text-sm">{t("subtitle")}</p>

        <ReferralView
          overview={overview}
          appUrl={process.env.NEXT_PUBLIC_APP_URL ?? "https://coligo.app"}
        />
      </div>
    </CustomerShell>
  );
}
