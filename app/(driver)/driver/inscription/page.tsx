import { redirect } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { requireDriverStage } from "@/lib/auth/driver-gate";
import { getDriverKyc } from "@/app/(driver)/actions";
import { DriverKycForm } from "@/components/driver/onboarding/kyc-form";
import { InfoNote } from "@/components/driver/onboarding/info-note";
import { OnboardingScreen } from "@/components/driver/onboarding/onboarding-screen";

export const dynamic = "force-dynamic";

/**
 * ÉTAPE 2 du parcours — vérification d'identité (KYC).
 *
 * Accessible uniquement au livreur dont le dossier n'est pas transmis (étape
 * « kyc »). Un livreur déjà en attente ou déjà vérifié est renvoyé sur son
 * propre écran par `requireDriverStage` : impossible de revenir en arrière.
 * Aucune fonctionnalité opérationnelle n'est atteignable depuis cet écran
 * (ni barre de navigation, ni bouton « En ligne », ni « Rejoindre un
 * commerçant »).
 */
export default async function DriverKycPage() {
  await requireDriverStage("kyc");
  const data = await getDriverKyc();
  if (!data) redirect("/driver/login");

  return (
    <OnboardingScreen
      icon={<ShieldCheck className="size-6" />}
      title="Votre dossier livreur"
      subtitle="Quelques minutes, rien de plus."
      info={
        <InfoNote title="Pourquoi ces informations ?">
          Elles sont exigées par la loi et protègent les clients comme les
          livreurs. Elles restent confidentielles et ne sont consultées que par
          l&apos;équipe Coligo.
        </InfoNote>
      }
      step={2}
      stepCount={4}
    >
      {/* NB : pas de bannière IDV ici — la vérification d'identité a désormais
          SON étape dans le formulaire (étape 2 « Vérification »), qui porte le
          choix instantané / manuel et l'état du parcours. Une bannière en tête
          ferait DOUBLON avec elle (règle projet : une information ne s'affiche
          qu'une seule fois par écran). */}
      <DriverKycForm data={data} />
    </OnboardingScreen>
  );
}
