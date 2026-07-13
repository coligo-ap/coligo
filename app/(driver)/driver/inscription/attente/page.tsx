import { Hourglass } from "lucide-react";
import { requireDriverStage } from "@/lib/auth/driver-gate";
import { OnboardingScreen } from "@/components/driver/onboarding/onboarding-screen";
import { DriverPendingView } from "@/components/driver/onboarding/pending-view";
import { IdvCallout } from "@/components/idv/idv-callout";

export const dynamic = "force-dynamic";

/**
 * ÉTAPES 3 et 4 du parcours — dossier transmis, en attente de validation.
 *
 * `requireDriverStage("pending")` est la garde : un livreur qui n'a pas encore
 * transmis son dossier est renvoyé au formulaire, un livreur déjà vérifié est
 * renvoyé à l'écran de félicitations. Retour arrière, rechargement et URL tapée
 * à la main aboutissent donc tous au même endroit — celui de son étape réelle.
 */
export default async function DriverPendingPage({
  searchParams,
}: {
  searchParams: Promise<{ envoye?: string }>;
}) {
  const [gate, sp] = await Promise.all([
    requireDriverStage("pending"),
    searchParams,
  ]);

  return (
    <OnboardingScreen
      icon={<Hourglass className="size-6" />}
      title="En attente de validation"
      subtitle="L'équipe Coligo examine actuellement votre identité, votre véhicule et vos documents."
      step={3}
      stepCount={4}
    >
      {/* Statut de la vérification d'identité automatique (IDV) : « vérifiée »,
          « en cours d'examen », ou l'invitation à la faire si elle reste à
          l'ordre du jour. S'efface d'elle-même si la fonctionnalité n'est pas
          publiée pour les livreurs. */}
      <div className="mb-4">
        <IdvCallout profile="driver" />
      </div>
      <DriverPendingView
        justSubmitted={sp.envoye === "1"}
        submittedAt={gate.submittedAt}
      />
    </OnboardingScreen>
  );
}
