import { redirect } from "next/navigation";
import { getAuthUser } from "@/lib/auth/session";
import { DriveView } from "@/components/customer/drive/drive-view";
import { CustomerFeatureBlocked } from "@/components/customer/feature-blocked-screen";
import { getFeatureFlag } from "@/lib/data/feature-flags";

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
    // Route NUE (sans coque) → écran plein AVEC la nav du bas, jamais une
    // page blanche sans issue.
    return <CustomerFeatureBlocked flag={flag} withNav />;
  }
  return <DriveView userId={user.id} />;
}
