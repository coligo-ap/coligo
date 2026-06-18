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
import { ColigoPayLoader } from "@/components/customer/coligo-pay-loader";

export const dynamic = "force-dynamic";

// =============================================================================
// /coligo-pay — page dédiée au SOLDE RÉEL (rechargeable par Chargily).
// =============================================================================
// Séparée volontairement de /cashback pour éviter toute confusion entre les
// deux "poches" :
//   - cashback   : récompense, non retirable, calculé sur les achats
//   - Coligo Pay : argent réel déposé par le client par carte CIB/EDAHABIA
//
// RSC ALLÉGÉ (pattern /commandes) : la page ne fait QUE les gardes (auth + flag)
// puis rend un loader client TanStack (ColigoPayLoader) qui charge solde /
// plafond / historique / tag depuis un cache persistant → l'écran s'affiche
// instantanément et ne « recharge » plus à chaque navigation. Les écritures
// sont filtrées sur source='topup' (cf. getMyTopupHistory).
// =============================================================================
export default async function CustomerColigoPayPage() {
  // Session mémoïsée (partagée avec le layout → pas de double auth).
  const user = await getAuthUser();
  if (!user) redirect("/se-connecter?next=/coligo-pay");

  // Garde commerçant + disponibilité (super-admin) en parallèle.
  const [merchant, flag] = await Promise.all([
    getCurrentMerchant(),
    getFeatureFlag("coligo_pay"),
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

  return <ColigoPayLoader userId={user.id} />;
}
