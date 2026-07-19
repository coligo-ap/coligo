import { Suspense } from "react";
import { PayCardTopup } from "@/components/wallet/pay/pay-card-topup";

/** Recharge par carte (Chargily) — montant → paiement → écran de résultat. */
export default function ChauffeurRechargeCartePage() {
  return (
    <div className="drive-jakarta drive-page pt-safe pb-safe-nav min-h-screen bg-[var(--d-surface)] px-5">
      {/* Suspense requis : PayCardTopup lit `?topup=` (retour Chargily). */}
      <Suspense fallback={null}>
        <PayCardTopup base="/chauffeur" />
      </Suspense>
    </div>
  );
}
