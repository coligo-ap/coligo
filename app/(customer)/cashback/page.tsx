import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { CustomerShell } from "@/components/customer/customer-shell";
import { FeatureUnavailable } from "@/components/customer/feature-unavailable";
import {
  getFeatureFlag,
  featureMessage,
  featureTitle,
} from "@/lib/data/feature-flags";
import { getAuthUser } from "@/lib/auth/session";
import { getCurrentMerchant } from "@/lib/auth/merchant";
import { CashbackLoader } from "@/components/customer/cashback-loader";

export const dynamic = "force-dynamic";

// RSC ALLÉGÉ (pattern /commandes, /coligo-pay) : la page ne fait QUE les gardes
// (auth + flag) puis rend un loader client TanStack (CashbackLoader) qui charge
// solde + historique depuis un cache persistant → affichage instantané au
// retour, plus de rechargement complet à chaque navigation.
export default async function CustomerCashbackPage() {
  const user = await getAuthUser();
  if (!user) redirect("/se-connecter?next=/cashback");

  // Garde commerçant + disponibilité (super-admin) en parallèle.
  const [merchant, flag] = await Promise.all([
    getCurrentMerchant(),
    getFeatureFlag("cashback"),
  ]);
  if (merchant) redirect("/dashboard");
  if (flag.status === "hidden") redirect("/");
  if (flag.status !== "active") {
    const locale = await getLocale();
    return (
      <CustomerShell>
        <div className="mx-auto max-w-2xl px-4 pt-6 pb-24 lg:px-6">
          <FeatureUnavailable
            status={flag.status}
            title={featureTitle(flag, locale)}
            message={featureMessage(flag, locale)}
          />
        </div>
      </CustomerShell>
    );
  }

  return <CashbackLoader userId={user.id} />;
}
