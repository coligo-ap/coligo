import { Suspense } from "react";
import { PayHome } from "@/components/wallet/pay/pay-home";
import { MerchantMoneyTabs } from "@/components/shared/money-tabs";
import RechargerLoading from "./loading";

/**
 * Coligo Pay commerçant — HOME du portefeuille (refonte workflow-oriented) :
 * solde + 3 actions (Recharger / Retirer / Historique) + aperçu du mois +
 * dernières opérations. Chaque action ouvre SA page dédiée. Accès ULTRA
 * RAPIDE : pas d'`await` serveur ici — l'auth est garantie par MerchantShell,
 * l'état du portefeuille est lu côté client via RPC scopée auth.uid().
 */
export default function MerchantRechargerPage() {
  return (
    <div className="mx-auto max-w-[1100px] p-4 lg:p-6 lg:px-8">
      {/* Hub Argent commerçant : Finances · Stats · Coligo Pay. */}
      <MerchantMoneyTabs />
      {/* Suspense requis : PayHome utilise useSearchParams (liens legacy). */}
      <Suspense fallback={<RechargerLoading />}>
        <PayHome base="" />
      </Suspense>
    </div>
  );
}
