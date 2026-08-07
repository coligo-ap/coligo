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
  const [user, flag, interFlag, carpoolFlag] = await Promise.all([
    getAuthUser(),
    getFeatureFlag("drive"),
    getFeatureFlag("drive_interwilaya"),
    getFeatureFlag("drive_carpool"),
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
  return (
    <DriveView
      userId={user.id}
      // Kill-switch dédié inter-wilayas (0442) : onglet retiré (hidden) ou
      // grisé + demande bloquée (bientôt/maintenance). L'enforcement réel est
      // dans le trigger DB — ici c'est l'UX.
      interFlag={{
        status: interFlag.status,
        message_fr: interFlag.message_fr,
        message_ar: interFlag.message_ar,
      }}
      carpoolOn={
        interFlag.status === "active" && carpoolFlag.status === "active"
      }
    />
  );
}
