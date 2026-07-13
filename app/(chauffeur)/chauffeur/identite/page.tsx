import { redirect } from "next/navigation";
import { getChauffeurGate } from "@/app/(chauffeur)/actions";
import { getIdvDocumentTypes, getIdvGate, getIdvModes } from "@/lib/idv/config";
import { getMyIdvVerification } from "@/lib/idv/user-data";
import { PartnerBackHeader } from "@/components/shared/partner-ui";
import { IdvFlow } from "@/components/idv/idv-flow";

export const dynamic = "force-dynamic";
// L'action de soumission attend l'analyse (OCR MRZ, liveness, face match).
export const maxDuration = 60;

/**
 * Vérification d'identité du CHAUFFEUR (chantier IDV, étape 9). Hors coque
 * `(app)` : parcours plein écran, comme /chauffeur/documents. Publiée /
 * retirée par le super-admin (flag + règle du profil `chauffeur`).
 */
export default async function ChauffeurIdentitePage() {
  const gate = await getChauffeurGate();
  if (!gate) redirect("/chauffeur/login");

  const idv = await getIdvGate("chauffeur");
  if (!idv.enabled) redirect("/chauffeur");

  const [docTypes, enabledModes, verification] = await Promise.all([
    getIdvDocumentTypes(),
    getIdvModes(),
    getMyIdvVerification("chauffeur"),
  ]);
  const modes = enabledModes.filter((m) => idv.allowedModes.includes(m.key));

  return (
    <div className="pt-safe pb-safe mx-auto min-h-[100dvh] max-w-md px-5">
      <PartnerBackHeader
        href="/chauffeur/compte"
        title="Vérification d'identité"
        subtitle="Document · selfie · validation"
      />
      <IdvFlow
        profile="chauffeur"
        docTypes={docTypes}
        modes={modes}
        canChooseMode={idv.userCanChooseMode && modes.length > 1}
        defaultMode={idv.defaultMode}
        verification={verification}
      />
    </div>
  );
}
