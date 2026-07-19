import { Suspense } from "react";
import { PayHome } from "@/components/wallet/pay/pay-home";
import { MoneyTabs } from "@/components/shared/money-tabs";

/**
 * Coligo Pay chauffeur — HOME du portefeuille (refonte workflow-oriented).
 * L'auth est garantie par la coque `(app)` (ChauffeurGateGuard) → pas
 * d'`await` ici, rendu instantané ; chaque action ouvre SA page dédiée.
 */
export default function ChauffeurRechargerPage() {
  return (
    <div className="drive-jakarta drive-page pt-safe pb-safe-nav min-h-screen bg-[var(--d-surface)] px-5">
      {/* Hub Argent : Gains · Courses · Coligo Pay dans une même page. */}
      <MoneyTabs base="/chauffeur" />
      <Suspense fallback={null}>
        <PayHome base="/chauffeur" />
      </Suspense>
    </div>
  );
}
