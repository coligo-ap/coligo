import { requireDriverStage } from "@/lib/auth/driver-gate";
import { DriverLogoutLink } from "@/components/driver/onboarding/driver-logout-link";
import { DriverWelcomeView } from "@/components/driver/onboarding/welcome-view";

export const dynamic = "force-dynamic";

/**
 * Retour du livreur après validation par l'équipe Coligo — félicitations, puis
 * choix du mode d'activité (Express ou commerçant).
 *
 * Qu'il arrive en ouvrant la notification le jour même ou en relançant
 * l'application des jours plus tard, il atterrit ici : tant que
 * `onboarding_done_at` est vide, la garde de toutes les pages opérationnelles
 * le ramène sur cet écran.
 *
 * Pas d'en-tête de page ici : le titre vit dans l'écran lui-même, qui change
 * selon l'étape (félicitations → choix du mode → intégration).
 */
export default async function DriverWelcomePage() {
  const gate = await requireDriverStage("welcome");

  return (
    <div className="min-h-[100dvh] bg-[var(--d-page)] text-[var(--d-ink)]">
      <main
        className="mx-auto flex min-h-[100dvh] max-w-md flex-col justify-center px-5 pt-[calc(2rem+env(safe-area-inset-top))]"
        style={{ paddingBottom: "calc(28px + env(safe-area-inset-bottom))" }}
      >
        <DriverWelcomeView
          firstName={gate.firstName}
          needsModeChoice={gate.needsModeChoice}
        />
        <div className="mt-8 text-center">
          <DriverLogoutLink />
        </div>
      </main>
    </div>
  );
}
