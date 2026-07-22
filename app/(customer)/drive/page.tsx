import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { getAuthUser } from "@/lib/auth/session";
import { DriveView } from "@/components/customer/drive/drive-view";
import { CustomerShell } from "@/components/customer/customer-shell";
import { FeatureUnavailable } from "@/components/customer/feature-unavailable";
import {
  getFeatureFlag,
  featureMessage,
  featureTitle,
} from "@/lib/data/feature-flags";

export const dynamic = "force-dynamic";

export default async function DrivePage() {
  // PERF : la session (mémoïsée, partagée avec CustomerShell) et la disponibilité
  // Drive sont INDÉPENDANTES → on les résout EN PARALLÈLE (chemin critique =
  // max(auth, flag) au lieu de la somme). Même principe que le gate super-admin.
  const [user, flag] = await Promise.all([
    getAuthUser(),
    getFeatureFlag("drive"),
  ]);
  if (!user) redirect("/se-connecter?next=/drive");

  // Disponibilité Drive (super-admin) : masqué → retour accueil ;
  // bientôt/maintenance → message ; actif → l'app Drive.
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
            personal={flag.personal}
          />
        </div>
      </CustomerShell>
    );
  }
  return <DriveView userId={user.id} />;
}
