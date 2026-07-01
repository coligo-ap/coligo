import { Suspense } from "react";
import { OperatorRecharge } from "@/components/wallet/operator-recharge";

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
    <div className="drive-jakarta drive-page min-h-screen bg-[var(--d-page)] px-5 pt-4 pb-24">
      <Suspense fallback={null}>
        <OperatorRecharge />
      </Suspense>
    </div>
  );
}
