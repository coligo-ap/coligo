import { Hourglass } from "lucide-react";
import { requireDriverStage } from "@/lib/auth/driver-gate";
import { OnboardingScreen } from "@/components/driver/onboarding/onboarding-screen";
import { DriverPendingView } from "@/components/driver/onboarding/pending-view";

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
      <DriverPendingView
        justSubmitted={sp.envoye === "1"}
        submittedAt={gate.submittedAt}
      />
    </OnboardingScreen>
  );
}
