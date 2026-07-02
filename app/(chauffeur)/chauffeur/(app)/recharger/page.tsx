import { Suspense } from "react";
import { OperatorRecharge } from "@/components/wallet/operator-recharge";
import { MoneyTabs } from "@/components/shared/money-tabs";

/**
 * Recharge portefeuille opérateur. L'auth est garantie par la coque `(app)`
 * (ChauffeurGateGuard) → pas d'`await` ici, rendu instantané.
 *
 * Un SEUL bouton retour : celui intégré à l'en-tête d'OperatorRecharge (sur la
 * ligne du titre « Mon portefeuille »). On ne remet plus de <DBack /> au-dessus
 * (doublon).
 */
export default function ChauffeurRechargerPage() {
  return (
    <div className="drive-jakarta drive-page min-h-screen bg-[var(--d-surface)] px-5 pt-4 pb-24">
      {/* Hub Argent : Gains · Courses · Coligo Pay dans une même page. */}
      <MoneyTabs base="/chauffeur" />
      <Suspense fallback={null}>
        <OperatorRecharge inHub />
      </Suspense>
    </div>
  );
}
