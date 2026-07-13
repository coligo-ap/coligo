import { redirect } from "next/navigation";
import { getCurrentDriver } from "@/lib/auth/driver";
import { getIdvDocumentTypes, getIdvGate, getIdvModes } from "@/lib/idv/config";
import { getMyIdvVerification } from "@/lib/idv/user-data";
import { DriverShell } from "@/components/driver/driver-shell";
import { PartnerBackHeader } from "@/components/shared/partner-ui";
import { IdvFlow } from "@/components/idv/idv-flow";

export const dynamic = "force-dynamic";

/**
 * Vérification d'identité automatisée du livreur (chantier IDV, étape 4).
 * Publiée/retirée par le super-admin (flag identity_verification + règle du
 * profil driver) : gate fermée ⇒ la page n'existe pas pour l'utilisateur.
 * Accessible dès la connexion (un livreur EN INSCRIPTION doit pouvoir
 * vérifier son identité — pas de requireActiveDriver ici).
 */
export default async function DriverIdentitePage() {
  const driver = await getCurrentDriver();
  if (!driver) redirect("/driver/login");

  const gate = await getIdvGate("driver");
  if (!gate.enabled) redirect("/driver");

  const [docTypes, enabledModes, verification] = await Promise.all([
    getIdvDocumentTypes(),
    getIdvModes(),
    getMyIdvVerification("driver"),
  ]);
  // Modes proposables = autorisés pour le profil ∩ actifs.
  const modes = enabledModes.filter((m) => gate.allowedModes.includes(m.key));

  return (
    <DriverShell driverFirstName={driver.full_name.split(" ")[0]}>
      <PartnerBackHeader
        href="/driver/parametres"
        title="Vérification d'identité"
        subtitle="Document · selfie · validation"
      />
      <IdvFlow
        docTypes={docTypes}
        modes={modes}
        canChooseMode={gate.userCanChooseMode && modes.length > 1}
        defaultMode={gate.defaultMode}
        verification={verification}
      />
    </DriverShell>
  );
}
