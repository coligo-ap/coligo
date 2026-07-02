import { Suspense } from "react";
import { OperatorRecharge } from "@/components/wallet/operator-recharge";
import { MerchantMoneyTabs } from "@/components/shared/money-tabs";
import RechargerLoading from "./loading";

/**
 * Coligo Pay commerçant (solde + recharge). Accès ULTRA RAPIDE : pas d'`await`
 * serveur ni de `force-dynamic` ici — l'auth (session + boutique) est déjà
 * garantie en amont par MerchantShell (layout), et l'état du portefeuille est
 * lu côté client par OperatorRecharge via un RPC protégé par RLS (auth.uid()).
 * Résultat : la navigation vers cette page est instantanée (aucun aller-retour
 * serveur bloquant avant le rendu), le composant gère son propre squelette
 * pendant le seul fetch client nécessaire.
 */
export default function MerchantRechargerPage() {
  return (
    <div className="mx-auto max-w-[1100px] p-4 lg:p-6 lg:px-8">
      {/* Hub Argent commerçant : Finances · Stats · Coligo Pay. */}
      <MerchantMoneyTabs />
      {/* Suspense requis : OperatorRecharge utilise useSearchParams. Fallback =
      squelette (jamais d'écran blanc, même en chargement direct/SSR). */}
      <Suspense fallback={<RechargerLoading />}>
        <OperatorRecharge />
      </Suspense>
    </div>
  );
}
