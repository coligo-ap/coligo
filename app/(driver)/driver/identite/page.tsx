import { redirect } from "next/navigation";
import { getLocale } from "next-intl/server";
import { getCurrentDriver } from "@/lib/auth/driver";
import { getDriverGate, routeForStage } from "@/lib/auth/driver-gate";
import { getIdvDocumentTypes, getIdvGate, getIdvModes } from "@/lib/idv/config";
import { getIdvCompliance } from "@/lib/idv/compliance";
import { getMyIdvVerification } from "@/lib/idv/user-data";
import { DriverShell } from "@/components/driver/driver-shell";
import { PartnerBackHeader } from "@/components/shared/partner-ui";
import { IdvFlow } from "@/components/idv/idv-flow";

export const dynamic = "force-dynamic";
// L'action de soumission attend l'analyse (OCR MRZ + portrait) : marge large.
export const maxDuration = 60;

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

  // Identité DÉJÀ confirmée : jamais rouvrir le parcours (un dossier approuvé
  // n'a plus de ligne « active » → l'écran repartirait de zéro, et resoumettre
  // ferait perdre le statut vérifié — cf. submitIdvDocument).
  const compliance = await getIdvCompliance("driver");
  if (compliance.verified) redirect("/driver");

  const [docTypes, enabledModes, verification, driverGate] = await Promise.all([
    getIdvDocumentTypes(),
    getIdvModes(),
    getMyIdvVerification("driver"),
    getDriverGate(),
  ]);
  // Le retour dépend de l'ÉTAPE réelle : un livreur en cours d'inscription
  // revient à son dossier, un livreur actif à son compte. (Sinon le bouton
  // « Retour » l'envoyait sur une page qui le redirige aussitôt.)
  const backHref =
    driverGate && driverGate.stage !== "active"
      ? routeForStage(driverGate.stage)
      : "/driver/parametres";
  // Modes proposables = autorisés pour le profil ∩ actifs.
  const modes = enabledModes.filter((m) => gate.allowedModes.includes(m.key));
  const isAr = (await getLocale()) === "ar";

  return (
    <DriverShell driverFirstName={driver.full_name.split(" ")[0]}>
      <PartnerBackHeader
        href={backHref}
        title={isAr ? "التحقّق من الهوية" : "Vérification d'identité"}
        subtitle={
          isAr ? "الوثيقة · سيلفي · المصادقة" : "Document · selfie · validation"
        }
      />
      <IdvFlow
        profile="driver"
        docTypes={docTypes}
        modes={modes}
        canChooseMode={gate.userCanChooseMode && modes.length > 1}
        defaultMode={gate.defaultMode}
        verification={verification}
      />
    </DriverShell>
  );
}
