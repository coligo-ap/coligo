import Link from "next/link";
import { redirect } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { getCurrentMerchant } from "@/lib/auth/merchant";
import { getIdvDocumentTypes, getIdvGate, getIdvModes } from "@/lib/idv/config";
import { getMyIdvVerification } from "@/lib/idv/user-data";
import { IdvFlow } from "@/components/idv/idv-flow";

export const dynamic = "force-dynamic";
// L'action de soumission attend l'analyse (OCR MRZ, liveness, face match).
export const maxDuration = 60;

/**
 * Vérification d'identité du COMMERÇANT — celle du TITULAIRE du commerce
 * (chantier IDV, étape 9). Publiée / retirée par le super-admin (flag + règle
 * du profil `merchant`).
 */
export default async function MerchantIdentitePage() {
  const merchant = await getCurrentMerchant();
  if (!merchant) redirect("/login");

  const idv = await getIdvGate("merchant");
  if (!idv.enabled) redirect("/dashboard");

  const [docTypes, enabledModes, verification] = await Promise.all([
    getIdvDocumentTypes(),
    getIdvModes(),
    getMyIdvVerification("merchant"),
  ]);
  const modes = enabledModes.filter((m) => idv.allowedModes.includes(m.key));

  return (
    <div className="mx-auto max-w-md px-4 pb-6">
      <header className="py-4">
        <Link
          href="/settings"
          className="text-muted hover:text-foreground mb-2 inline-flex items-center gap-1 text-sm"
        >
          <ArrowLeft className="size-4" />
          Retour aux réglages
        </Link>
        <h1 className="text-xl font-bold tracking-tight">
          Vérification d&apos;identité
        </h1>
        <p className="text-muted mt-0.5 text-sm">
          Identité du titulaire du commerce.
        </p>
      </header>
      <IdvFlow
        profile="merchant"
        docTypes={docTypes}
        modes={modes}
        canChooseMode={idv.userCanChooseMode && modes.length > 1}
        defaultMode={idv.defaultMode}
        verification={verification}
      />
    </div>
  );
}
